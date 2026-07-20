import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { redis } from "../src/shared/redis.js";
import { registerDriver, setAvailability, recordLocation, geoSetKey } from "../src/modules/drivers/service.js";
import { approveDriver, adminListTrips } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse, reassignTripDriver } from "../src/modules/dispatch/service.js";
import { arriveTrip, cancelTripAsAdmin, startTrip } from "../src/modules/trips/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { ConflictError, NotFoundError } from "../src/shared/errors.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];
const tripIds: string[] = [];

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

async function makeAcceptedTrip(riderId: string, driverId: string) {
  const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
  await handleDriverResponse(trip.id, driverId, true);
  return prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
}

async function cleanupTrip(tripId: string): Promise<void> {
  await prisma.tripLocation.deleteMany({ where: { tripId } });
  await prisma.ledgerEntry.deleteMany({ where: { tripId } });
  await prisma.trip.deleteMany({ where: { id: tripId } });
}

describe("trip management (dispatcher panel)", () => {
  // A fresh vehicle type per test (not beforeAll) — otherwise drivers from an
  // earlier test are still in the shared GEO pool and the dispatch cascade
  // can offer a trip to one of them instead of the driver a later test just
  // created, same isolation trip-lifecycle.test.ts relies on.
  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `TripMgmtTest-${Date.now()}-${Math.random()}`,
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

  describe("adminListTrips", () => {
    it("filters by status and search", async () => {
      const rider = await makeRider("+201000099901");
      const driver = await makeOnlineDriver("+201000099911", "TRIPMGMT-001", 30.0505, 31.2305);
      const trip = await makeAcceptedTrip(rider, driver);
      tripIds.push(trip.id);

      const byStatus = await adminListTrips({ status: "accepted" });
      expect(byStatus.some((t) => t.id === trip.id)).toBe(true);

      const bySearch = await adminListTrips({ search: "+201000099901" });
      expect(bySearch.some((t) => t.id === trip.id)).toBe(true);

      const wrongStatus = await adminListTrips({ status: "paid" });
      expect(wrongStatus.some((t) => t.id === trip.id)).toBe(false);
    });
  });

  describe("cancelTripAsAdmin", () => {
    it("cancels a searching trip, no fee, audit-logged", async () => {
      const rider = await makeRider("+201000099902");
      const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
      tripIds.push(trip.id);
      expect(trip.status).toBe("no_drivers_found"); // no online driver for this fresh vehicle type yet
      await prisma.trip.update({ where: { id: trip.id }, data: { status: "searching" } });

      const cancelled = await cancelTripAsAdmin(trip.id, "staff-1", "Operational cancel");
      expect(cancelled.status).toBe("cancelled_by_rider");
      expect(cancelled.cancelledBy).toBeNull();
      expect(cancelled.cancellationFee).toBeNull();

      const entry = await prisma.auditLog.findFirst({ where: { actorId: "staff-1", action: "trip.cancel", targetId: trip.id } });
      expect(entry).not.toBeNull();
    });

    it("cancelling an accepted trip releases the driver back to the GEO pool, no fee charged", async () => {
      const rider = await makeRider("+201000099903");
      const driver = await makeOnlineDriver("+201000099912", "TRIPMGMT-002", 30.0505, 31.2305);
      const trip = await makeAcceptedTrip(rider, driver);
      tripIds.push(trip.id);

      const cancelled = await cancelTripAsAdmin(trip.id, "staff-1", "Driver reported an issue");
      expect(cancelled.status).toBe("cancelled_by_rider");
      expect(cancelled.cancellationFee).toBeNull(); // admin cancels never charge, unlike a rider self-cancel

      const backInPool = await redis.zscore(geoSetKey(vehicleTypeId), driver);
      expect(backInPool).not.toBeNull();
    });

    it("rejects cancelling a trip already in progress", async () => {
      const rider = await makeRider("+201000099904");
      const driver = await makeOnlineDriver("+201000099913", "TRIPMGMT-003", 30.0505, 31.2305);
      const trip = await makeAcceptedTrip(rider, driver);
      tripIds.push(trip.id);
      await arriveTrip(trip.id, driver);
      const arrived = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
      await startTrip(trip.id, driver, arrived.otp!);

      await expect(cancelTripAsAdmin(trip.id, "staff-1", "too late")).rejects.toThrow(ConflictError);
    });

    it("404s for an unknown trip", async () => {
      await expect(cancelTripAsAdmin("00000000-0000-0000-0000-000000000000", "staff-1", "x")).rejects.toThrow(NotFoundError);
    });
  });

  describe("reassignTripDriver", () => {
    it("swaps the driver on an accepted trip, releasing the old one and locking the new one", async () => {
      const rider = await makeRider("+201000099905");
      const oldDriver = await makeOnlineDriver("+201000099914", "TRIPMGMT-004", 30.0505, 31.2305);
      const newDriver = await makeOnlineDriver("+201000099915", "TRIPMGMT-005", 30.0510, 31.2310);
      const trip = await makeAcceptedTrip(rider, oldDriver);
      tripIds.push(trip.id);

      const reassigned = await reassignTripDriver(trip.id, newDriver, "staff-1");
      expect(reassigned.driverId).toBe(newDriver);
      expect(reassigned.status).toBe("accepted"); // unchanged — not a state-machine transition

      const oldBackInPool = await redis.zscore(geoSetKey(vehicleTypeId), oldDriver);
      expect(oldBackInPool).not.toBeNull();
      const newInPool = await redis.zscore(geoSetKey(vehicleTypeId), newDriver);
      expect(newInPool).toBeNull(); // busy now

      const entry = await prisma.auditLog.findFirst({ where: { actorId: "staff-1", action: "trip.reassign", targetId: trip.id } });
      expect(entry).not.toBeNull();
    });

    it("rejects reassigning to a driver who isn't free (already on another trip)", async () => {
      const rider1 = await makeRider("+201000099906");
      const rider2 = await makeRider("+201000099907");
      const busyDriver = await makeOnlineDriver("+201000099916", "TRIPMGMT-006", 30.0505, 31.2305);
      const targetDriverOriginal = await makeOnlineDriver("+201000099917", "TRIPMGMT-007", 30.0510, 31.2310);

      const trip1 = await makeAcceptedTrip(rider1, busyDriver); // busyDriver now off the GEO pool
      tripIds.push(trip1.id);
      const trip2 = await makeAcceptedTrip(rider2, targetDriverOriginal);
      tripIds.push(trip2.id);

      await expect(reassignTripDriver(trip2.id, busyDriver, "staff-1")).rejects.toThrow(ConflictError);
    });

    it("rejects reassigning a trip that hasn't been accepted yet", async () => {
      const rider = await makeRider("+201000099908");
      const driver = await makeOnlineDriver("+201000099918", "TRIPMGMT-008", 30.0505, 31.2305);
      const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
      tripIds.push(trip.id);

      await expect(reassignTripDriver(trip.id, driver, "staff-1")).rejects.toThrow(ConflictError);
    });

    it("404s for an unknown trip", async () => {
      const driver = await makeOnlineDriver("+201000099919", "TRIPMGMT-009", 30.0505, 31.2305);
      await expect(reassignTripDriver("00000000-0000-0000-0000-000000000000", driver, "staff-1")).rejects.toThrow(NotFoundError);
    });
  });
});
