// trips module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { getConfigValue } from "../../shared/config.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { estimateFares } from "../fares/service.js";
import { nextStatus, type TripEvent, type TripStatus } from "./state-machine.js";

const ACTIVE_TRIP_EXCLUDED_STATUSES: TripStatus[] = [
  "paid",
  "cancelled_by_rider",
  "cancelled_by_driver",
  "no_drivers_found",
  "expired",
];

export interface CreateTripInput {
  pickup: { lat: number; lng: number; address?: string };
  drop: { lat: number; lng: number; address?: string };
  vehicleTypeId: string;
  paymentMethod: "cash" | "wallet" | "card";
}

/**
 * Creates the Trip row in `requested` status: snapshots a fare estimate
 * (fares/service.ts) and generates the pickup OTP. Does not touch dispatch —
 * see dispatch/service.ts:requestTrip for the create+dispatch orchestration.
 */
export async function createTripRecord(riderId: string, input: CreateTripInput) {
  const active = await prisma.trip.findFirst({
    where: { riderId, status: { notIn: ACTIVE_TRIP_EXCLUDED_STATUSES } },
  });
  if (active) {
    throw new ConflictError("You already have an active trip");
  }

  const [estimate] = await estimateFares(input.pickup, input.drop, input.vehicleTypeId);
  if (!estimate) {
    throw new NotFoundError("Vehicle type not found or inactive");
  }

  const otpLength = await getConfigValue("otp_length", 4);
  const otp = String(randomInt(0, 10 ** otpLength)).padStart(otpLength, "0");

  const trip = await prisma.trip.create({
    data: {
      riderId,
      vehicleTypeId: input.vehicleTypeId,
      status: "requested",
      pickupAddress: input.pickup.address,
      dropAddress: input.drop.address,
      otp,
      distanceM: estimate.distanceM,
      durationS: estimate.durationS,
      fareBreakdown: estimate.breakdown as unknown as Prisma.InputJsonValue,
      fareTotal: estimate.breakdown.total,
      paymentMethod: input.paymentMethod,
      paymentStatus: "pending",
      requestedAt: new Date(),
    },
  });

  await prisma.$executeRaw`
    UPDATE trips
    SET pickup_point = ST_SetSRID(ST_MakePoint(${input.pickup.lng}, ${input.pickup.lat}), 4326),
        drop_point = ST_SetSRID(ST_MakePoint(${input.drop.lng}, ${input.drop.lat}), 4326)
    WHERE id = ${trip.id}
  `;

  return trip;
}

export async function getTripPickupPoint(tripId: string): Promise<{ lat: number; lng: number } | null> {
  const rows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
    SELECT ST_Y(pickup_point) AS lat, ST_X(pickup_point) AS lng FROM trips WHERE id = ${tripId}
  `;
  return rows[0] ?? null;
}

const TIMESTAMP_FIELD_BY_STATUS: Partial<Record<TripStatus, string>> = {
  accepted: "acceptedAt",
  arrived: "arrivedAt",
  started: "startedAt",
  completed: "completedAt",
  paid: "paidAt",
  cancelled_by_rider: "cancelledAt",
  cancelled_by_driver: "cancelledAt",
};

/**
 * The ONLY place trip.status changes (CLAUDE.md rule 2). Validates the
 * event against state-machine.ts and stamps the matching timestamp column.
 * `extra` lets a caller set other columns atomically with the transition
 * (e.g. driverId/vehicleId on driver_accept).
 */
export async function transitionTrip(
  tripId: string,
  event: TripEvent,
  extra: Record<string, unknown> = {},
) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new NotFoundError("Trip not found");
  }

  const next = nextStatus(trip.status, event);
  if (!next) {
    throw new ConflictError(`Cannot apply event "${event}" to a trip in status "${trip.status}"`);
  }

  const timestampField = TIMESTAMP_FIELD_BY_STATUS[next];

  return prisma.trip.update({
    where: { id: tripId },
    data: {
      status: next,
      ...(timestampField ? { [timestampField]: new Date() } : {}),
      ...extra,
    },
  });
}

export async function getTripForParticipant(tripId: string, userId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      vehicleType: true,
      driver: { select: { id: true, name: true, phone: true } },
      vehicle: true,
    },
  });
  if (!trip) {
    throw new NotFoundError("Trip not found");
  }
  if (trip.riderId !== userId && trip.driverId !== userId) {
    throw new ForbiddenError("Not a participant on this trip");
  }
  return trip;
}
