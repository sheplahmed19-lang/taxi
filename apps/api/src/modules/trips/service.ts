// trips module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { getConfigValue } from "../../shared/config.js";
import { logger } from "../../shared/logger.js";
import { getRoute, haversineMeters } from "../../shared/maps.js";
import { emitToTrip, emitToUser } from "../../realtime/index.js";
import { redis } from "../../shared/redis.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { calculateFinalFare, estimateFares } from "../fares/service.js";
import { applyPromoDiscount } from "../fares/engine.js";
import { geoSetKey, getDriverState } from "../drivers/service.js";
import { postCashTripEarnings, postElectronicTripEarnings, settleWalletTripPayment } from "../wallet/service.js";
import { sendToUser } from "../notifications/service.js";
import {
  getPromoDiscountTerms,
  recordPromoRedemption,
  releasePromoRedemption,
  resolveAndValidatePromo,
} from "../promos/service.js";
import { enqueueReferralBonusCheck } from "../../jobs/referralBonus.js";
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
  promoCode?: string;
}

/**
 * Creates the Trip row in `requested` status: snapshots a fare estimate
 * (fares/service.ts) and generates the pickup OTP. Does not touch dispatch —
 * see dispatch/service.ts:requestTrip for the create+dispatch orchestration.
 *
 * An optional promoCode is validated against this same estimate (promos
 * module owns eligibility rules) and, if it passes, its discount is folded
 * into the stored breakdown/total before the trip is created — this is
 * Phase 3.1's "apply-at-estimate" behavior.
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

  let fareBreakdown = estimate.breakdown;
  let promoId: string | undefined;
  if (input.promoCode) {
    const promo = await resolveAndValidatePromo(input.promoCode, {
      userId: riderId,
      vehicleTypeId: input.vehicleTypeId,
      pickup: input.pickup,
      preDiscountFare: estimate.breakdown.total,
    });
    const { promoDiscount, total } = applyPromoDiscount(estimate.breakdown.total, promo);
    fareBreakdown = { ...estimate.breakdown, promoDiscount, total };
    promoId = promo.id;
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
      fareBreakdown: fareBreakdown as unknown as Prisma.InputJsonValue,
      fareTotal: fareBreakdown.total,
      paymentMethod: input.paymentMethod,
      paymentStatus: "pending",
      promoId,
      requestedAt: new Date(),
    },
  });

  await prisma.$executeRaw`
    UPDATE trips
    SET pickup_point = ST_SetSRID(ST_MakePoint(${input.pickup.lng}, ${input.pickup.lat}), 4326),
        drop_point = ST_SetSRID(ST_MakePoint(${input.drop.lng}, ${input.drop.lat}), 4326)
    WHERE id = ${trip.id}
  `;

  if (promoId) {
    await recordPromoRedemption(promoId, riderId, trip.id);
  }

  return trip;
}

/**
 * Attaches a promo to a trip after it's already been created (rider decided
 * to add a code while waiting for a driver) but before it starts — once a
 * driver is en route/on-trip the fare is close to being locked in anyway.
 * Re-validates eligibility against the trip's own vehicle type/pickup/fare
 * (limits can have moved since the code was typed), then patches the stored
 * breakdown/total exactly like the at-creation path.
 */
export async function applyPromoToTrip(tripId: string, riderId: string, code: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new NotFoundError("Trip not found");
  }
  if (trip.riderId !== riderId) {
    throw new ForbiddenError("Not your trip");
  }
  if (!["requested", "searching", "accepted", "arrived"].includes(trip.status)) {
    throw new ConflictError("Promo codes can only be applied before the trip starts");
  }
  if (trip.promoId) {
    throw new ConflictError("A promo code is already applied to this trip");
  }

  const pickup = await getTripPickupPoint(tripId);
  if (!pickup) {
    throw new ConflictError("Trip has no pickup location on record");
  }

  const preDiscountTotal = trip.fareTotal ?? 0;
  const promo = await resolveAndValidatePromo(code, {
    userId: riderId,
    vehicleTypeId: trip.vehicleTypeId,
    pickup,
    preDiscountFare: preDiscountTotal,
  });

  const { promoDiscount, total } = applyPromoDiscount(preDiscountTotal, promo);
  const fareBreakdown = { ...(trip.fareBreakdown as Record<string, unknown>), promoDiscount, total };

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: {
      promoId: promo.id,
      fareTotal: total,
      fareBreakdown: fareBreakdown as unknown as Prisma.InputJsonValue,
    },
  });

  await recordPromoRedemption(promo.id, riderId, tripId);

  emitToTrip(tripId, "trip:fare_updated", { tripId, fareBreakdown, fareTotal: total });

  return updated;
}

export async function getTripPickupPoint(tripId: string): Promise<{ lat: number; lng: number } | null> {
  const rows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
    SELECT ST_Y(pickup_point) AS lat, ST_X(pickup_point) AS lng FROM trips WHERE id = ${tripId}
  `;
  return rows[0] ?? null;
}

export async function getTripDropPoint(tripId: string): Promise<{ lat: number; lng: number } | null> {
  const rows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
    SELECT ST_Y(drop_point) AS lat, ST_X(drop_point) AS lng FROM trips WHERE id = ${tripId}
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

  // pickup/drop are PostGIS geometry columns (Unsupported in the Prisma
  // schema — see prisma/schema.prisma), so they're never part of the
  // default select above and have to be fetched separately. The driver
  // app's navigate-to-pickup screen needs real coordinates, not just the
  // free-text address.
  const [pickup, drop] = await Promise.all([getTripPickupPoint(tripId), getTripDropPoint(tripId)]);

  return { ...trip, pickup, drop };
}

// ── Live location relay + batched trip_locations persistence ──────────────
// "Batch-insert": pings are buffered in-process and flushed periodically
// rather than hitting the DB on every 3-5s socket ping. TripLocation.point
// is an Unsupported geometry column, so Prisma Client can't write it —
// each flushed row goes through raw SQL.

interface BufferedLocation {
  tripId: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  recordedAt: Date;
}

const locationBuffer: BufferedLocation[] = [];
const LOCATION_FLUSH_INTERVAL_MS = 10_000;

function bufferTripLocation(entry: BufferedLocation): void {
  locationBuffer.push(entry);
}

export async function flushTripLocations(): Promise<void> {
  if (locationBuffer.length === 0) {
    return;
  }
  const batch = locationBuffer.splice(0, locationBuffer.length);
  await prisma.$transaction(
    batch.map(
      (entry) => prisma.$executeRaw`
        INSERT INTO trip_locations (id, trip_id, point, speed, heading, recorded_at)
        VALUES (
          gen_random_uuid(),
          ${entry.tripId},
          ST_SetSRID(ST_MakePoint(${entry.lng}, ${entry.lat}), 4326),
          ${entry.speed ?? null},
          ${entry.heading ?? null},
          ${entry.recordedAt}
        )
      `,
    ),
  );
}

setInterval(() => {
  flushTripLocations().catch((err: unknown) => {
    logger.error({ err }, "trip location flush failed");
  });
}, LOCATION_FLUSH_INTERVAL_MS);

export interface DriverLocationPing {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  ts?: number;
}

/**
 * Called from the driver:location socket handler (via a dynamic import to
 * avoid a realtime<->trips circular import — see realtime/index.ts). Relays
 * to the trip room for any active trip this driver is on, and buffers the
 * ping for trip_locations once the trip is actually `started`.
 */
export async function relayAndRecordTripLocation(driverId: string, location: DriverLocationPing): Promise<void> {
  const trip = await prisma.trip.findFirst({
    where: { driverId, status: { in: ["accepted", "arrived", "started"] } },
  });
  if (!trip) {
    return;
  }

  emitToTrip(trip.id, "trip:driver_location", {
    lat: location.lat,
    lng: location.lng,
    heading: location.heading ?? 0,
  });

  if (trip.status === "started") {
    bufferTripLocation({
      tripId: trip.id,
      lat: location.lat,
      lng: location.lng,
      speed: location.speed,
      heading: location.heading,
      recordedAt: location.ts ? new Date(location.ts) : new Date(),
    });
  }
}

// ── Lifecycle transitions ──────────────────────────────────────────────────

export async function arriveTrip(tripId: string, driverId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new NotFoundError("Trip not found");
  }
  if (trip.driverId !== driverId) {
    throw new ForbiddenError("Not the assigned driver");
  }

  const updated = await transitionTrip(tripId, "driver_arrive");
  emitToTrip(tripId, "trip:status", { tripId, status: updated.status });
  return updated;
}

export async function startTrip(tripId: string, driverId: string, otp: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new NotFoundError("Trip not found");
  }
  if (trip.driverId !== driverId) {
    throw new ForbiddenError("Not the assigned driver");
  }
  if (trip.otp !== otp) {
    throw new ForbiddenError("Invalid OTP");
  }

  const updated = await transitionTrip(tripId, "trip_start");
  emitToTrip(tripId, "trip:status", { tripId, status: updated.status });
  return updated;
}

/**
 * Ends the trip: flushes any pending location pings, computes the actual
 * distance/duration (haversine sum over recorded trip_locations, falling
 * back to a route lookup if too few pings were recorded), and re-runs the
 * fare engine against those real numbers — overwriting the pre-trip
 * estimate snapshotted at creation.
 */
export async function completeTrip(tripId: string, driverId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new NotFoundError("Trip not found");
  }
  if (trip.driverId !== driverId) {
    throw new ForbiddenError("Not the assigned driver");
  }

  await flushTripLocations();

  const points = await prisma.$queryRaw<Array<{ lat: number; lng: number; recordedAt: Date }>>`
    SELECT ST_Y(point) AS lat, ST_X(point) AS lng, recorded_at AS "recordedAt"
    FROM trip_locations
    WHERE trip_id = ${tripId}
    ORDER BY recorded_at ASC
  `;

  let distanceM: number;
  let durationS: number;

  if (points.length >= 2) {
    let sumM = 0;
    for (let i = 1; i < points.length; i++) {
      sumM += haversineMeters(points[i - 1]!, points[i]!);
    }
    distanceM = Math.round(sumM);
    durationS = Math.round(
      (points[points.length - 1]!.recordedAt.getTime() - points[0]!.recordedAt.getTime()) / 1000,
    );
  } else {
    const [pickup, drop] = await Promise.all([getTripPickupPoint(tripId), getTripDropPoint(tripId)]);
    const route = pickup && drop ? await getRoute(pickup, drop) : null;
    distanceM = route?.distanceM ?? trip.distanceM ?? 0;
    durationS = route?.durationS ?? trip.durationS ?? 0;
  }

  const pickup = await getTripPickupPoint(tripId);
  const promoTerms = trip.promoId ? await getPromoDiscountTerms(trip.promoId) : null;
  const breakdown = pickup
    ? await calculateFinalFare(pickup, trip.vehicleTypeId, distanceM, durationS, promoTerms ?? undefined)
    : null;

  const updated = await transitionTrip(tripId, "trip_complete", {
    distanceM,
    durationS,
    ...(breakdown
      ? { fareBreakdown: breakdown as unknown as Prisma.InputJsonValue, fareTotal: breakdown.total }
      : {}),
  });

  // Free to take new trips again — re-add to the GEO index at their last
  // known position, but only if they're still marked online (they may have
  // gone offline mid-trip, e.g. end of shift).
  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId: driverId },
    include: { currentVehicle: true },
  });
  if (driverProfile?.online && driverProfile.currentVehicle) {
    const state = await getDriverState(driverId);
    if (state) {
      await redis.geoadd(geoSetKey(driverProfile.currentVehicle.vehicleTypeId), state.lng, state.lat, driverId);
    }
  }

  // Cash close-out (Phase 1.8): the rider already paid the driver directly,
  // so there's nothing to charge — just record the commission the driver
  // now owes the platform and mark the trip settled. Card settlement is a
  // separate rider-initiated step (payments/service.ts:initRidePayment ->
  // webhook -> markTripPaid above).
  let finalTrip = updated;
  if (trip.paymentMethod === "cash") {
    await postCashTripEarnings(tripId, driverId, trip.vehicleTypeId, updated.fareTotal ?? 0);
    finalTrip = await transitionTrip(tripId, "payment_settled", { paymentStatus: "paid" });
  } else if (trip.paymentMethod === "wallet") {
    const { paid } = await settleWalletTripPayment(tripId, trip.riderId, driverId, trip.vehicleTypeId, updated.fareTotal ?? 0);
    if (paid) {
      finalTrip = await transitionTrip(tripId, "payment_settled", { paymentStatus: "paid" });
    } else {
      // Insufficient wallet balance — fall back to cash rather than leaving
      // the trip stuck unpaid. The driver still needs to collect physically,
      // so the rider (and CLAUDE.md rule 3-compliant commission tracking)
      // both need to reflect that the payment method actually changed.
      await postCashTripEarnings(tripId, driverId, trip.vehicleTypeId, updated.fareTotal ?? 0);
      finalTrip = await transitionTrip(tripId, "payment_settled", {
        paymentStatus: "paid",
        paymentMethod: "cash",
      });
      await sendToUser(trip.riderId, {
        title: "Wallet balance too low",
        body: "Your wallet didn't have enough balance for this ride — please pay the driver in cash.",
        data: { tripId, type: "wallet_fallback_cash" },
      });
    }
  }

  if (finalTrip.status === "paid") {
    await enqueueReferralBonusCheck(trip.riderId, tripId);
    if (driverId) {
      await enqueueReferralBonusCheck(driverId, tripId);
    }
  }

  emitToTrip(tripId, "trip:status", {
    tripId,
    status: finalTrip.status,
    payload: { fareBreakdown: breakdown, fareTotal: breakdown?.total ?? finalTrip.fareTotal },
  });

  return finalTrip;
}

/**
 * Card/wallet settlement (Phase 2.2+): called once the payment gateway
 * confirms the charge succeeded (payments/service.ts's webhook handler) or
 * a wallet debit clears. Mirrors the cash path in completeTrip() but posts
 * via postElectronicTripEarnings (no owe_amounts liability — the platform
 * already holds the money) and is itself idempotent: a trip already at
 * "paid" is left alone rather than re-posting or throwing on the now-invalid
 * "payment_settled" transition, since gateway webhooks can be retried.
 */
export async function markTripPaid(tripId: string, amountPaid: number): Promise<void> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new NotFoundError("Trip not found");
  }
  if (trip.status === "paid") {
    return;
  }
  if (!trip.driverId) {
    throw new ConflictError("Trip has no assigned driver to settle payment to");
  }

  await postElectronicTripEarnings(tripId, trip.driverId, trip.vehicleTypeId, amountPaid);
  const updated = await transitionTrip(tripId, "payment_settled", { paymentStatus: "paid" });

  await enqueueReferralBonusCheck(trip.riderId, tripId);
  await enqueueReferralBonusCheck(trip.driverId, tripId);

  emitToTrip(tripId, "trip:status", { tripId, status: updated.status });
}

/**
 * Either participant can cancel. A rider cancelling after the driver has
 * already accepted (or arrived) incurs the configured cancellation_fee —
 * recorded on the trip; actually charging it is Phase 2's job once the
 * wallet/ledger exists. A driver cancelling never charges the rider.
 */
export async function cancelTrip(tripId: string, userId: string, reason: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new NotFoundError("Trip not found");
  }

  const isRider = trip.riderId === userId;
  const isDriver = trip.driverId === userId;
  if (!isRider && !isDriver) {
    throw new ForbiddenError("Not a participant on this trip");
  }

  const event: TripEvent = isRider ? "rider_cancel" : "driver_cancel";
  const cancelledBy = isRider ? "rider" : "driver";

  let cancellationFee: number | null = null;
  if (isRider && (trip.status === "accepted" || trip.status === "arrived")) {
    cancellationFee = await getConfigValue("cancellation_fee", 0);
  }

  const updated = await transitionTrip(tripId, event, {
    cancelledBy,
    cancelReason: reason,
    ...(cancellationFee !== null ? { cancellationFee } : {}),
  });

  if (trip.promoId) {
    // Frees the usage-limit slot — a cancelled ride never actually redeemed the promo.
    await releasePromoRedemption(tripId);
  }

  const otherPartyId = isRider ? trip.driverId : trip.riderId;
  if (otherPartyId) {
    emitToUser(otherPartyId, "trip:status", {
      tripId,
      status: updated.status,
      payload: { reason, cancelledBy },
    });
  }

  return updated;
}

const RATABLE_STATUSES: TripStatus[] = ["completed", "paid"];

/** Either participant rates the other, once, after the trip is done. */
export async function rateTrip(tripId: string, raterId: string, stars: number, review?: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new NotFoundError("Trip not found");
  }

  const isRider = trip.riderId === raterId;
  const isDriver = trip.driverId === raterId;
  if (!isRider && !isDriver) {
    throw new ForbiddenError("Not a participant on this trip");
  }
  if (!RATABLE_STATUSES.includes(trip.status)) {
    throw new ConflictError("Trip is not yet completed");
  }

  const rateeId = isRider ? trip.driverId : trip.riderId;
  if (!rateeId) {
    throw new ConflictError("No counterparty to rate");
  }

  const existing = await prisma.rating.findUnique({
    where: { tripId_raterId: { tripId, raterId } },
  });
  if (existing) {
    throw new ConflictError("You already rated this trip");
  }

  const rating = await prisma.rating.create({ data: { tripId, raterId, rateeId, stars, review } });

  if (isRider) {
    const agg = await prisma.rating.aggregate({ where: { rateeId }, _avg: { stars: true } });
    await prisma.driverProfile.update({
      where: { userId: rateeId },
      data: { ratingAvg: agg._avg.stars ?? 0 },
    });
  }

  return rating;
}
