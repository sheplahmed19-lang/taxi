import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { redis } from "../src/shared/redis.js";
import { registerDriver, setAvailability, recordLocation, geoSetKey } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import {
  arriveTrip,
  cancelTrip,
  completeTrip,
  flushTripLocations,
  rateTrip,
  relayAndRecordTripLocation,
  startTrip,
} from "../src/modules/trips/service.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../src/shared/errors.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];

async function makeRider(phone: string): Promise<string> {
  const user = await prisma.user.upsert({ where: { phone }, update: {}, create: { phone, role: "rider" } });
  userIds.push(user.id);
  return user.id;
}

async function makeOnlineDriver(phone: string, plate: string, lat: number, lng: number): Promise<string> {
  const user = await prisma.user.upsert({ where: { phone }, update: {}, create: { phone, role: "driver" } });
  await registerDriver(user.id, { vehicleTypeId, plate });
  await approveDriver(user.id);
  await setAvailability(user.id, true);
  await recordLocation(user.id, { lat, lng });
  userIds.push(user.id);
  return user.id;
}

/** Drives a fresh trip through requested -> searching -> accepted using the real Phase 1.4 dispatch path. */
async function makeAcceptedTrip(riderId: string, driverId: string) {
  const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
  await handleDriverResponse(trip.id, driverId, true);
  return prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
}

async function cleanupTrip(tripId: string): Promise<void> {
  await prisma.rating.deleteMany({ where: { tripId } });
  await prisma.tripLocation.deleteMany({ where: { tripId } });
  await prisma.trip.delete({ where: { id: tripId } });
}

describe("trip lifecycle", () => {
  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `LifecycleTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        nightStart: "22:00",
        nightEnd: "06:00",
        active: true,
      },
    });
    vehicleTypeId = vt.id;
    vehicleTypeIds.push(vt.id);
  });

  afterAll(async () => {
    await closeDispatchTimeout();
    for (const id of userIds) {
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("arrive: only the assigned driver can mark arrived", async () => {
    const rider = await makeRider("+201000044441");
    const driver = await makeOnlineDriver("+201000055551", "LIFE-001", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);

    const other = await makeRider("+201000044442");
    await expect(arriveTrip(trip.id, other)).rejects.toThrow(ForbiddenError);
    await expect(arriveTrip("00000000-0000-0000-0000-000000000000", driver)).rejects.toThrow(NotFoundError);

    const arrived = await arriveTrip(trip.id, driver);
    expect(arrived.status).toBe("arrived");
    expect(arrived.arrivedAt).not.toBeNull();

    await cleanupTrip(trip.id);
  });

  it("start: requires the correct OTP", async () => {
    const rider = await makeRider("+201000044443");
    const driver = await makeOnlineDriver("+201000055552", "LIFE-002", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);
    await arriveTrip(trip.id, driver);

    await expect(startTrip(trip.id, driver, "0000")).rejects.toThrow(ForbiddenError);
    await expect(startTrip(trip.id, driver, "0000")).rejects.toThrow(/otp/i);

    const started = await startTrip(trip.id, driver, trip.otp!);
    expect(started.status).toBe("started");
    expect(started.startedAt).not.toBeNull();

    await cleanupTrip(trip.id);
  });

  it("relays driver location to the trip room and only persists trip_locations once started", async () => {
    const rider = await makeRider("+201000044444");
    const driver = await makeOnlineDriver("+201000055553", "LIFE-003", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);

    // Still "accepted" (en route to pickup): relay happens but nothing persists.
    await relayAndRecordTripLocation(driver, { lat: 30.051, lng: 31.231 });
    await flushTripLocations();
    let stored = await prisma.tripLocation.count({ where: { tripId: trip.id } });
    expect(stored).toBe(0);

    await arriveTrip(trip.id, driver);
    await startTrip(trip.id, driver, trip.otp!);

    await relayAndRecordTripLocation(driver, { lat: 30.052, lng: 31.232, speed: 20 });
    await relayAndRecordTripLocation(driver, { lat: 30.053, lng: 31.233, speed: 22 });
    await flushTripLocations();

    stored = await prisma.tripLocation.count({ where: { tripId: trip.id } });
    expect(stored).toBe(2);

    await cleanupTrip(trip.id);
  });

  it("complete: computes actual distance from recorded pings and re-runs the fare engine", async () => {
    const rider = await makeRider("+201000044445");
    const driver = await makeOnlineDriver("+201000055554", "LIFE-004", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);
    await arriveTrip(trip.id, driver);
    await startTrip(trip.id, driver, trip.otp!);

    await relayAndRecordTripLocation(driver, { lat: 30.05, lng: 31.23 });
    await relayAndRecordTripLocation(driver, { lat: 30.06, lng: 31.24 });
    await flushTripLocations();

    const completed = await completeTrip(trip.id, driver);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();
    expect(completed.distanceM).toBeGreaterThan(0);
    expect(completed.fareTotal).toBeGreaterThan(0);

    // Driver should be back in the GEO index, free for new dispatches.
    const backOnline = await redis.zscore(geoSetKey(vehicleTypeId), driver);
    expect(backOnline).not.toBeNull();

    await cleanupTrip(trip.id);
  });

  it("complete: falls back to a route lookup when too few location pings were recorded", async () => {
    const rider = await makeRider("+201000044446");
    const driver = await makeOnlineDriver("+201000055555", "LIFE-005", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);
    await arriveTrip(trip.id, driver);
    await startTrip(trip.id, driver, trip.otp!);
    // No location pings recorded during the trip at all.

    const completed = await completeTrip(trip.id, driver);
    expect(completed.status).toBe("completed");
    expect(completed.distanceM).toBeGreaterThan(0);

    await cleanupTrip(trip.id);
  });

  it("cancel: no fee before the driver has accepted", async () => {
    const rider = await makeRider("+201000044447");
    const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    expect(trip.status).toBe("no_drivers_found"); // no online drivers for this dedicated vehicle type

    // Force it back to a cancellable pre-accept state for this assertion.
    await prisma.trip.update({ where: { id: trip.id }, data: { status: "requested" } });
    const cancelled = await cancelTrip(trip.id, rider, "Changed my mind");
    expect(cancelled.status).toBe("cancelled_by_rider");
    expect(cancelled.cancellationFee).toBeNull();

    await cleanupTrip(trip.id);
  });

  it("cancel: rider cancelling after acceptance incurs the configured fee", async () => {
    const rider = await makeRider("+201000044448");
    const driver = await makeOnlineDriver("+201000055556", "LIFE-006", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);

    const cancelled = await cancelTrip(trip.id, rider, "Changed my mind");
    expect(cancelled.status).toBe("cancelled_by_rider");
    expect(cancelled.cancellationFee).toBe(500); // seeded cancellation_fee

    await cleanupTrip(trip.id);
  });

  it("cancel: driver cancelling never charges a fee", async () => {
    const rider = await makeRider("+201000044449");
    const driver = await makeOnlineDriver("+201000055557", "LIFE-007", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);

    const cancelled = await cancelTrip(trip.id, driver, "Vehicle broke down");
    expect(cancelled.status).toBe("cancelled_by_driver");
    expect(cancelled.cancellationFee).toBeNull();

    await cleanupTrip(trip.id);
  });

  it("cancel: rejects a non-participant", async () => {
    const rider = await makeRider("+201000044450");
    const driver = await makeOnlineDriver("+201000055558", "LIFE-008", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);
    const stranger = await makeRider("+201000044451");

    await expect(cancelTrip(trip.id, stranger, "not mine")).rejects.toThrow(ForbiddenError);

    await cleanupTrip(trip.id);
  });

  it("rate: rider rating the driver updates the driver's rolling average, once", async () => {
    const rider = await makeRider("+201000044452");
    const driver = await makeOnlineDriver("+201000055559", "LIFE-009", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);
    await arriveTrip(trip.id, driver);
    await startTrip(trip.id, driver, trip.otp!);
    await completeTrip(trip.id, driver);

    const rating = await rateTrip(trip.id, rider, 4, "Good ride");
    expect(rating.stars).toBe(4);

    const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId: driver } });
    expect(profile.ratingAvg.toNumber()).toBe(4);

    await expect(rateTrip(trip.id, rider, 5)).rejects.toThrow(ConflictError);

    await cleanupTrip(trip.id);
  });

  it("rate: rejects rating a trip that isn't completed yet", async () => {
    const rider = await makeRider("+201000044453");
    const driver = await makeOnlineDriver("+201000055560", "LIFE-010", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);

    await expect(rateTrip(trip.id, rider, 5)).rejects.toThrow(ConflictError);

    await cleanupTrip(trip.id);
  });
});
