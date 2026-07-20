import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { listMyTrips } from "../src/modules/trips/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";

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

async function makeRider(phone: string): Promise<string> {
  const user = await prisma.user.upsert({ where: { phone }, update: {}, create: { phone, role: "rider" } });
  userIds.push(user.id);
  return user.id;
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

describe("ride history (Phase 4.5)", () => {
  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `MyTripsTest-${Date.now()}-${Math.random()}`,
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

  it("lists a rider's own trips, newest first, and never someone else's", async () => {
    const rider = await makeRider(phoneFor("066601"));
    const stranger = await makeRider(phoneFor("066602"));
    const driver = await makeOnlineDriver(phoneFor("066611"), "MYTRIPS-001", 30.0505, 31.2305);

    const trip1 = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripIds.push(trip1.id);
    await handleDriverResponse(trip1.id, driver, true);

    const strangerTrip = await requestTrip(stranger, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripIds.push(strangerTrip.id);

    const mine = await listMyTrips(rider);
    expect(mine.some((t) => t.id === trip1.id)).toBe(true);
    expect(mine.some((t) => t.id === strangerTrip.id)).toBe(false);
    expect(mine[0]?.id).toBe(trip1.id); // most recent first
  });

  it("also lists a driver's own trips (they're the driverId, not riderId)", async () => {
    const rider = await makeRider(phoneFor("066603"));
    const driver = await makeOnlineDriver(phoneFor("066612"), "MYTRIPS-002", 30.0505, 31.2305);

    const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripIds.push(trip.id);
    await handleDriverResponse(trip.id, driver, true);

    const mine = await listMyTrips(driver);
    expect(mine.some((t) => t.id === trip.id)).toBe(true);
  });

  it("cursor pagination returns the next page starting after the given trip", async () => {
    const rider = await makeRider(phoneFor("066604"));
    const driver = await makeOnlineDriver(phoneFor("066613"), "MYTRIPS-003", 30.0505, 31.2305);

    const trips = [];
    for (let i = 0; i < 3; i++) {
      const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
      tripIds.push(trip.id);
      await handleDriverResponse(trip.id, driver, true);
      await prisma.trip.update({ where: { id: trip.id }, data: { driverId: null, status: "cancelled_by_rider" } });
      trips.push(trip.id);
      await setAvailability(driver, true);
      await recordLocation(driver, { lat: 30.0505, lng: 31.2305 });
    }

    const firstPage = await listMyTrips(rider);
    expect(firstPage.length).toBeGreaterThanOrEqual(3);

    const secondPage = await listMyTrips(rider, firstPage[0]!.id);
    expect(secondPage.some((t) => t.id === firstPage[0]!.id)).toBe(false);
  });
});
