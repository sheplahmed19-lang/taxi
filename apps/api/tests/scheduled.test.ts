import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import {
  cancelScheduledRide,
  createScheduledRide,
  getScheduledRide,
  listMyScheduledRides,
  updateScheduledRide,
} from "../src/modules/scheduled/service.js";
import { scheduledRidesQueue, closeScheduledRides } from "../src/jobs/scheduledRides.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/shared/errors.js";

const pickup = { lat: 30.05, lng: 31.23, address: "Downtown Plaza" };
const drop = { lat: 30.06, lng: 31.24, address: "Uptown Mall" };

let riderId: string;
let otherRiderId: string;
let vehicleTypeId: string;
const scheduledRideIds: string[] = [];

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

describe("scheduled rides — service", () => {
  beforeAll(async () => {
    const rider = await prisma.user.upsert({
      where: { phone: "+201000055501" },
      update: {},
      create: { phone: "+201000055501", role: "rider" },
    });
    riderId = rider.id;

    const other = await prisma.user.upsert({
      where: { phone: "+201000055502" },
      update: {},
      create: { phone: "+201000055502", role: "rider" },
    });
    otherRiderId = other.id;

    const vt = await prisma.vehicleType.create({
      data: {
        name: `ScheduledTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeId = vt.id;
  });

  afterAll(async () => {
    await closeScheduledRides();
    await prisma.scheduledRide.deleteMany({ where: { id: { in: scheduledRideIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [riderId, otherRiderId] } } });
    await prisma.vehicleType.delete({ where: { id: vehicleTypeId } });
    await prisma.$disconnect();
  });

  it("rejects a scheduledFor that's too soon (inside the dispatch lead time)", async () => {
    await expect(
      createScheduledRide(riderId, {
        pickup,
        drop,
        vehicleTypeId,
        paymentMethod: "cash",
        scheduledFor: new Date(Date.now() + 5 * 60_000), // 5 min — lead time defaults to 15
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an unknown vehicle type", async () => {
    await expect(
      createScheduledRide(riderId, {
        pickup,
        drop,
        vehicleTypeId: "00000000-0000-0000-0000-000000000000",
        paymentMethod: "cash",
        scheduledFor: hoursFromNow(3),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("creates a pending scheduled ride and enqueues its jobs", async () => {
    const ride = await createScheduledRide(riderId, {
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
      scheduledFor: hoursFromNow(3),
    });
    scheduledRideIds.push(ride.id);

    expect(ride.status).toBe("pending");
    expect(ride.pickupLat).toBe(pickup.lat);
    expect(ride.tripId).toBeNull();

    const remindJob = await scheduledRidesQueue.getJob(`scheduled-ride-remind-${ride.id}`);
    const dispatchJob = await scheduledRidesQueue.getJob(`scheduled-ride-dispatch-${ride.id}`);
    expect(remindJob).toBeDefined();
    expect(dispatchJob).toBeDefined();
  });

  it("lists only the owning rider's scheduled rides, soonest first", async () => {
    const later = await createScheduledRide(riderId, {
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
      scheduledFor: hoursFromNow(10),
    });
    scheduledRideIds.push(later.id);

    const mine = await listMyScheduledRides(riderId);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.every((r) => r.riderId === riderId)).toBe(true);
    for (let i = 1; i < mine.length; i++) {
      expect(mine[i]!.scheduledFor.getTime()).toBeGreaterThanOrEqual(mine[i - 1]!.scheduledFor.getTime());
    }

    const othersView = await listMyScheduledRides(otherRiderId);
    expect(othersView).toHaveLength(0);
  });

  it("getScheduledRide 404s on unknown id and 403s on someone else's ride", async () => {
    await expect(getScheduledRide(riderId, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(NotFoundError);

    const ride = await createScheduledRide(riderId, {
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
      scheduledFor: hoursFromNow(4),
    });
    scheduledRideIds.push(ride.id);

    await expect(getScheduledRide(otherRiderId, ride.id)).rejects.toThrow(ForbiddenError);
  });

  it("updateScheduledRide edits fields and reschedules jobs while still pending", async () => {
    const ride = await createScheduledRide(riderId, {
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
      scheduledFor: hoursFromNow(5),
    });
    scheduledRideIds.push(ride.id);

    const newTime = hoursFromNow(6);
    const updated = await updateScheduledRide(riderId, ride.id, {
      paymentMethod: "wallet",
      scheduledFor: newTime,
    });

    expect(updated.paymentMethod).toBe("wallet");
    expect(updated.scheduledFor.getTime()).toBe(newTime.getTime());

    const dispatchJob = await scheduledRidesQueue.getJob(`scheduled-ride-dispatch-${ride.id}`);
    expect(dispatchJob).toBeDefined();
  });

  it("updateScheduledRide rejects editing a non-pending ride", async () => {
    const ride = await createScheduledRide(riderId, {
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
      scheduledFor: hoursFromNow(4),
    });
    scheduledRideIds.push(ride.id);
    await prisma.scheduledRide.update({ where: { id: ride.id }, data: { status: "dispatched" } });

    await expect(updateScheduledRide(riderId, ride.id, { paymentMethod: "card" })).rejects.toThrow(ConflictError);
  });

  it("cancelScheduledRide drops the pending jobs and marks cancelled", async () => {
    const ride = await createScheduledRide(riderId, {
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
      scheduledFor: hoursFromNow(4),
    });
    scheduledRideIds.push(ride.id);

    const cancelled = await cancelScheduledRide(riderId, ride.id);
    expect(cancelled.status).toBe("cancelled");

    const dispatchJob = await scheduledRidesQueue.getJob(`scheduled-ride-dispatch-${ride.id}`);
    expect(dispatchJob).toBeUndefined();

    await expect(cancelScheduledRide(riderId, ride.id)).rejects.toThrow(ConflictError);
  });
});
