// scheduled module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { getConfigValue } from "../../shared/config.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../shared/errors.js";
import { estimateFares } from "../fares/service.js";
import { cancelTrip } from "../trips/service.js";
import { cancelJobsForRide, rescheduleJobsForRide, scheduleJobsForRide } from "../../jobs/scheduledRides.js";
import type { ScheduledRide } from "@prisma/client";

export interface ScheduledLocation {
  lat: number;
  lng: number;
  address: string;
}

export interface CreateScheduledRideInput {
  pickup: ScheduledLocation;
  drop: ScheduledLocation;
  vehicleTypeId: string;
  paymentMethod: "cash" | "wallet" | "card";
  scheduledFor: Date;
}

async function requireMinimumLeadTime(scheduledFor: Date): Promise<void> {
  const leadMinutes = await getConfigValue("scheduled_dispatch_lead_minutes", 15);
  const minimumFuture = Date.now() + leadMinutes * 60_000;
  if (scheduledFor.getTime() <= minimumFuture) {
    throw new ValidationError(`Scheduled time must be at least ${leadMinutes} minutes from now`);
  }
}

/**
 * Fails fast on an unroutable pickup/drop or an unknown/inactive vehicle
 * type. The fare itself is deliberately NOT snapshotted here — a scheduled
 * ride's fare is computed fresh (fares/config may have moved by then) when
 * jobs/scheduledRides.ts actually dispatches it.
 */
async function validateRoute(pickup: ScheduledLocation, drop: ScheduledLocation, vehicleTypeId: string): Promise<void> {
  await estimateFares(pickup, drop, vehicleTypeId);
}

export async function createScheduledRide(riderId: string, input: CreateScheduledRideInput): Promise<ScheduledRide> {
  await requireMinimumLeadTime(input.scheduledFor);
  await validateRoute(input.pickup, input.drop, input.vehicleTypeId);

  const ride = await prisma.scheduledRide.create({
    data: {
      riderId,
      pickupAddress: input.pickup.address,
      pickupLat: input.pickup.lat,
      pickupLng: input.pickup.lng,
      dropAddress: input.drop.address,
      dropLat: input.drop.lat,
      dropLng: input.drop.lng,
      vehicleTypeId: input.vehicleTypeId,
      paymentMethod: input.paymentMethod,
      scheduledFor: input.scheduledFor,
      status: "pending",
    },
  });

  await scheduleJobsForRide(ride.id, ride.scheduledFor);
  return ride;
}

export async function listMyScheduledRides(riderId: string): Promise<ScheduledRide[]> {
  return prisma.scheduledRide.findMany({ where: { riderId }, orderBy: { scheduledFor: "asc" } });
}

async function getOwnedRide(riderId: string, id: string): Promise<ScheduledRide> {
  const ride = await prisma.scheduledRide.findUnique({ where: { id } });
  if (!ride) {
    throw new NotFoundError("Scheduled ride not found");
  }
  if (ride.riderId !== riderId) {
    throw new ForbiddenError("Not your scheduled ride");
  }
  return ride;
}

export async function getScheduledRide(riderId: string, id: string): Promise<ScheduledRide> {
  return getOwnedRide(riderId, id);
}

export interface UpdateScheduledRideInput {
  pickup?: ScheduledLocation;
  drop?: ScheduledLocation;
  vehicleTypeId?: string;
  paymentMethod?: "cash" | "wallet" | "card";
  scheduledFor?: Date;
}

/** Only a still-pending ride (not yet handed off to dispatch) can be edited. */
export async function updateScheduledRide(riderId: string, id: string, input: UpdateScheduledRideInput): Promise<ScheduledRide> {
  const ride = await getOwnedRide(riderId, id);
  if (ride.status !== "pending") {
    throw new ConflictError("This ride has already been dispatched (or cancelled) and can no longer be edited");
  }

  const scheduledFor = input.scheduledFor ?? ride.scheduledFor;
  if (input.scheduledFor) {
    await requireMinimumLeadTime(scheduledFor);
  }

  const pickup = input.pickup ?? { lat: ride.pickupLat, lng: ride.pickupLng, address: ride.pickupAddress };
  const drop = input.drop ?? { lat: ride.dropLat, lng: ride.dropLng, address: ride.dropAddress };
  const vehicleTypeId = input.vehicleTypeId ?? ride.vehicleTypeId;
  if (input.pickup || input.drop || input.vehicleTypeId) {
    await validateRoute(pickup, drop, vehicleTypeId);
  }

  const updated = await prisma.scheduledRide.update({
    where: { id },
    data: {
      pickupAddress: pickup.address,
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      dropAddress: drop.address,
      dropLat: drop.lat,
      dropLng: drop.lng,
      vehicleTypeId,
      paymentMethod: input.paymentMethod ?? ride.paymentMethod,
      scheduledFor,
    },
  });

  await rescheduleJobsForRide(id, scheduledFor);
  return updated;
}

/**
 * Before dispatch: just marks the row cancelled and drops the pending jobs.
 * After dispatch (a Trip already exists): also cancels that trip through
 * the normal trips/service.ts path, so cancellation-fee rules etc. still apply.
 */
export async function cancelScheduledRide(riderId: string, id: string): Promise<ScheduledRide> {
  const ride = await getOwnedRide(riderId, id);
  if (ride.status === "cancelled") {
    throw new ConflictError("This ride is already cancelled");
  }

  if (ride.status === "pending") {
    await cancelJobsForRide(id);
  } else if (ride.tripId) {
    await cancelTrip(ride.tripId, riderId, "Scheduled ride cancelled by rider");
  }

  return prisma.scheduledRide.update({ where: { id }, data: { status: "cancelled" } });
}

/** Driver app's upcoming-scheduled list: this driver's own assigned trips that started life as a scheduled ride and haven't started yet. */
export async function listUpcomingForDriver(driverId: string) {
  return prisma.trip.findMany({
    where: {
      driverId,
      scheduledAt: { not: null },
      status: { in: ["accepted", "arrived"] },
    },
    orderBy: { scheduledAt: "asc" },
  });
}
