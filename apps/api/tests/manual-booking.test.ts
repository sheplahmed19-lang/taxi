import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { assignDriverToTrip, createManualBooking } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { ConflictError } from "../src/shared/errors.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];
const tripIds: string[] = [];
const suffix = Date.now();

function phoneFor(prefix: string): string {
  return `+201${prefix}${suffix}`.slice(0, 15);
}

async function makeOnlineDriver(phone: string, plate: string, lat: number, lng: number): Promise<string> {
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, role: "driver", wallet: { create: { balance: 0 } } },
  });
  await registerDriver(user.id, { vehicleTypeId, plate });
  await approveDriver(user.id);
  await setAvailability(user.id, true);
  await recordLocation(user.id, { lat, lng });
  userIds.push(user.id);
  return user.id;
}

async function cleanupTrip(tripId: string): Promise<void> {
  await prisma.tripLocation.deleteMany({ where: { tripId } });
  await prisma.ledgerEntry.deleteMany({ where: { tripId } });
  await prisma.trip.deleteMany({ where: { id: tripId } });
}

describe("manual booking (dispatcher panel)", () => {
  // A fresh vehicle type per test — otherwise an earlier test's driver is
  // still in the shared GEO pool and the no-chosen-driver cascade test could
  // offer to the wrong one (see trip-management.test.ts for the same fix).
  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `ManualBookingTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeId = vt.id;
    vehicleTypeIds.push(vt.id);
  });

  afterAll(async () => {
    await closeDispatchTimeout();
    for (const id of tripIds) {
      await cleanupTrip(id).catch(() => undefined);
    }
    for (const id of userIds) {
      await prisma.oweAmount.deleteMany({ where: { driverId: id } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("finds-or-creates a rider by phone and dispatches normally without a chosen driver", async () => {
    await makeOnlineDriver(phoneFor("77701"), "MANBOOK-001", 30.0505, 31.2305);
    const phone = phoneFor("88801");

    // No driverId — this runs the same nearest-candidate cascade a rider's
    // own POST /trips does, which offers to the driver over their socket and
    // waits for a response; it doesn't auto-accept, so status stays "searching"
    // (see trip-lifecycle.test.ts's makeAcceptedTrip, which drives the same
    // cascade through to "accepted" via a real handleDriverResponse call).
    const trip = await createManualBooking("staff-1", {
      phone,
      name: "Phone Rider",
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
    });
    tripIds.push(trip.id);

    expect(trip.status).toBe("searching");
    expect(trip.driverId).toBeNull();

    const rider = await prisma.user.findUniqueOrThrow({ where: { phone } });
    expect(rider.role).toBe("rider");
    expect(rider.name).toBe("Phone Rider");

    const entry = await prisma.auditLog.findFirst({ where: { actorId: "staff-1", action: "trip.manual_booking", targetId: trip.id } });
    expect(entry).not.toBeNull();

    userIds.push(rider.id);
  });

  it("reuses an existing rider account for a phone that's already registered", async () => {
    const phone = phoneFor("88802");
    const existing = await prisma.user.create({ data: { phone, role: "rider", name: "Existing Rider" } });
    userIds.push(existing.id);
    await makeOnlineDriver(phoneFor("77702"), "MANBOOK-002", 30.0505, 31.2305);

    const trip = await createManualBooking("staff-1", { phone, pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripIds.push(trip.id);

    expect(trip.riderId).toBe(existing.id);
    const rider = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(rider.name).toBe("Existing Rider"); // not overwritten — a name was already on file
  });

  it("assigns a specific chosen driver instead of the nearest-candidate cascade", async () => {
    const nearer = await makeOnlineDriver(phoneFor("77703"), "MANBOOK-003", 30.0501, 31.2301);
    const chosen = await makeOnlineDriver(phoneFor("77704"), "MANBOOK-004", 30.09, 31.29); // farther away
    const phone = phoneFor("88803");

    const trip = await createManualBooking("staff-1", {
      phone,
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
      driverId: chosen,
    });
    tripIds.push(trip.id);

    expect(trip.driverId).toBe(chosen);
    expect(trip.driverId).not.toBe(nearer);

    const rider = await prisma.user.findFirst({ where: { phone } });
    if (rider) userIds.push(rider.id);
  });

  it("assignDriverToTrip rejects a driver who's already busy with another trip", async () => {
    const driverA = await makeOnlineDriver(phoneFor("77705"), "MANBOOK-005", 30.0505, 31.2305);
    const phoneA = phoneFor("88804");
    const phoneB = phoneFor("88805");

    const trip1 = await createManualBooking("staff-1", {
      phone: phoneA,
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
      driverId: driverA,
    });
    tripIds.push(trip1.id);

    // driverA is now busy (accepted trip1, pulled from the GEO pool) — a second
    // manual booking trying to force-assign them should fail cleanly.
    const trip2 = await createManualBooking("staff-1", { phone: phoneB, pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripIds.push(trip2.id);

    await expect(assignDriverToTrip(trip2.id, driverA)).rejects.toThrow(ConflictError);

    const riderA = await prisma.user.findFirst({ where: { phone: phoneA } });
    const riderB = await prisma.user.findFirst({ where: { phone: phoneB } });
    if (riderA) userIds.push(riderA.id);
    if (riderB) userIds.push(riderB.id);
  });

  it("rejects assigning an offline driver", async () => {
    const offline = await makeOnlineDriver(phoneFor("77706"), "MANBOOK-006", 30.0505, 31.2305);
    await setAvailability(offline, false);
    const phone = phoneFor("88806");

    await expect(
      createManualBooking("staff-1", { phone, pickup, drop, vehicleTypeId, paymentMethod: "cash", driverId: offline }),
    ).rejects.toThrow(ConflictError);

    const rider = await prisma.user.findFirst({ where: { phone } });
    if (rider) userIds.push(rider.id);
    // The trip was created (rider account exists) but assignment failed and threw —
    // no trip row to clean up since createTripRecord happens inside requestTrip
    // before the throw, so it's left in "searching". Clean it up explicitly.
    const orphanTrip = await prisma.trip.findFirst({ where: { riderId: rider?.id, status: "searching" } });
    if (orphanTrip) tripIds.push(orphanTrip.id);
  });
});
