import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { scheduledRidesQueue, closeScheduledRides } from "../src/jobs/scheduledRides.js";
import { listUpcomingForDriver } from "../src/modules/scheduled/service.js";

const pickup = { lat: 30.05, lng: 31.23, address: "Downtown Plaza" };
const drop = { lat: 30.06, lng: 31.24, address: "Uptown Mall" };

async function waitFor(conditionFn: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await conditionFn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition not met in time");
}

let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];
const scheduledRideIds: string[] = [];
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

async function makeScheduledRide(riderId: string, overrides: Partial<{ vehicleTypeId: string }> = {}) {
  const ride = await prisma.scheduledRide.create({
    data: {
      riderId,
      pickupAddress: pickup.address,
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      dropAddress: drop.address,
      dropLat: drop.lat,
      dropLng: drop.lng,
      vehicleTypeId: overrides.vehicleTypeId ?? vehicleTypeId,
      paymentMethod: "cash",
      scheduledFor: new Date(Date.now() + 3 * 60 * 60 * 1000),
      status: "pending",
    },
  });
  scheduledRideIds.push(ride.id);
  return ride;
}

describe("scheduled rides — BullMQ worker", () => {
  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `ScheduledJobTest-${Date.now()}-${Math.random()}`,
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
    await closeScheduledRides();
    for (const tripId of tripIds) {
      await prisma.tripLocation.deleteMany({ where: { tripId } });
      await prisma.ledgerEntry.deleteMany({ where: { tripId } });
    }
    await prisma.scheduledRide.deleteMany({ where: { id: { in: scheduledRideIds } } });
    await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
    for (const id of userIds) {
      await prisma.oweAmount.deleteMany({ where: { driverId: id } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("'remind' sends a push notification to the rider", async () => {
    const riderId = await makeRider("+201000055601");
    const ride = await makeScheduledRide(riderId);

    await scheduledRidesQueue.add("remind", { scheduledRideId: ride.id }, { delay: 50 });

    await waitFor(async () => {
      const notification = await prisma.notification.findFirst({
        where: { userId: riderId, title: "Upcoming scheduled ride" },
      });
      return notification !== null;
    });
  });

  it("'dispatch' creates a real trip, links it, and marks the ride dispatched", async () => {
    const riderId = await makeRider("+201000055602");
    const driverId = await makeOnlineDriver("+201000055611", "SCHED-001", 30.0505, 31.2305);
    const ride = await makeScheduledRide(riderId);

    await scheduledRidesQueue.add("dispatch", { scheduledRideId: ride.id }, { delay: 50 });

    await waitFor(async () => {
      const row = await prisma.scheduledRide.findUniqueOrThrow({ where: { id: ride.id } });
      return row.status === "dispatched";
    });

    const updatedRide = await prisma.scheduledRide.findUniqueOrThrow({ where: { id: ride.id } });
    expect(updatedRide.tripId).not.toBeNull();
    tripIds.push(updatedRide.tripId!);

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: updatedRide.tripId! } });
    expect(trip.riderId).toBe(riderId);
    expect(trip.vehicleTypeId).toBe(vehicleTypeId);
    expect(trip.scheduledAt?.getTime()).toBe(ride.scheduledFor.getTime());
    expect(["searching", "no_drivers_found", "accepted"]).toContain(trip.status);

    void driverId;
  });

  it("'dispatch' handles a rider with a conflicting active trip gracefully (no crash, ride still marked dispatched, rider notified)", async () => {
    const riderId = await makeRider("+201000055603");
    // An online driver for this trip's own vehicleTypeId, left un-responded-to, keeps
    // the trip in "searching" (an active status) rather than falling straight through
    // to the terminal "no_drivers_found", which wouldn't block a second request.
    await makeOnlineDriver("+201000055621", "SCHED-CONFLICT", 30.0505, 31.2305);
    const activeTrip = await requestTrip(riderId, {
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
    });
    tripIds.push(activeTrip.id);
    expect(activeTrip.status).toBe("searching");

    const ride = await makeScheduledRide(riderId);
    await scheduledRidesQueue.add("dispatch", { scheduledRideId: ride.id }, { delay: 50 });

    await waitFor(async () => {
      const row = await prisma.scheduledRide.findUniqueOrThrow({ where: { id: ride.id } });
      return row.status === "dispatched";
    });

    const updatedRide = await prisma.scheduledRide.findUniqueOrThrow({ where: { id: ride.id } });
    expect(updatedRide.tripId).toBeNull();

    const failureNotification = await prisma.notification.findFirst({
      where: { userId: riderId, title: "Couldn't start your scheduled ride" },
    });
    expect(failureNotification).not.toBeNull();
  });

  it("skips a ride that's already been cancelled by the time its job fires", async () => {
    const riderId = await makeRider("+201000055604");
    const ride = await makeScheduledRide(riderId);
    await prisma.scheduledRide.update({ where: { id: ride.id }, data: { status: "cancelled" } });

    await scheduledRidesQueue.add("dispatch", { scheduledRideId: ride.id }, { delay: 50 });

    // Give the worker a moment to run, then confirm it stayed cancelled with no trip attached.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const row = await prisma.scheduledRide.findUniqueOrThrow({ where: { id: ride.id } });
    expect(row.status).toBe("cancelled");
    expect(row.tripId).toBeNull();
  });

  it("listUpcomingForDriver returns only this driver's accepted/arrived scheduled-origin trips", async () => {
    const riderId = await makeRider("+201000055605");
    const driverId = await makeOnlineDriver("+201000055612", "SCHED-002", 30.0505, 31.2305);

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripIds.push(trip.id);
    await prisma.trip.update({ where: { id: trip.id }, data: { scheduledAt: new Date(), driverId, status: "accepted" } });

    const upcoming = await listUpcomingForDriver(driverId);
    expect(upcoming.some((t) => t.id === trip.id)).toBe(true);

    const otherDriverId = await makeOnlineDriver("+201000055613", "SCHED-003", 30.0505, 31.2305);
    const emptyList = await listUpcomingForDriver(otherDriverId);
    expect(emptyList).toHaveLength(0);
  });
});
