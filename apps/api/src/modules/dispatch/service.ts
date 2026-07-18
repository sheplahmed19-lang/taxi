// dispatch module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import type { Trip } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { redis } from "../../shared/redis.js";
import { logger } from "../../shared/logger.js";
import { getConfigValue } from "../../shared/config.js";
import { getRoute } from "../../shared/maps.js";
import { sendPushToUser } from "../../shared/fcm.js";
import { emitToUser, joinTripRoom } from "../../realtime/index.js";
import { geoSetKey, getDriverState } from "../drivers/service.js";
import { createTripRecord, getTripPickupPoint, transitionTrip, type CreateTripInput } from "../trips/service.js";
import { scheduleDispatchTimeout } from "../../jobs/dispatchTimeout.js";

const MAX_CANDIDATES_TO_SCAN = 20;

function offeredSetKey(tripId: string): string {
  return `trip:${tripId}:dispatch:offered`;
}
function currentDriverKey(tripId: string): string {
  return `trip:${tripId}:dispatch:current`;
}
function radiusKey(tripId: string): string {
  return `trip:${tripId}:dispatch:radius`;
}
function expandedKey(tripId: string): string {
  return `trip:${tripId}:dispatch:expanded`;
}
function driverLockKey(driverId: string): string {
  return `dispatch:lock:driver:${driverId}`;
}

async function clearDispatchState(tripId: string): Promise<void> {
  await redis.del(offeredSetKey(tripId), currentDriverKey(tripId), radiusKey(tripId), expandedKey(tripId));
}

interface RankedCandidate {
  driverId: string;
  distanceM: number;
}

async function rankedCandidates(
  vehicleTypeId: string,
  pickup: { lat: number; lng: number },
  radiusKm: number,
): Promise<RankedCandidate[]> {
  const matches = (await redis.geosearch(
    geoSetKey(vehicleTypeId),
    "FROMLONLAT",
    pickup.lng,
    pickup.lat,
    "BYRADIUS",
    radiusKm,
    "km",
    "ASC",
    "COUNT",
    MAX_CANDIDATES_TO_SCAN,
    "WITHDIST",
  )) as Array<[string, string]>;

  return matches.map(([driverId, distKm]) => ({ driverId, distanceM: Math.round(parseFloat(distKm) * 1000) }));
}

/**
 * Picks the nearest not-yet-offered, not-currently-locked driver and
 * acquires their dispatch lock atomically (SET NX) so two trips dispatching
 * concurrently can't both offer to the same driver at once.
 */
async function findAndLockNextCandidate(
  tripId: string,
  vehicleTypeId: string,
  pickup: { lat: number; lng: number },
  radiusKm: number,
  lockTtlS: number,
): Promise<RankedCandidate | null> {
  const alreadyOffered = new Set(await redis.smembers(offeredSetKey(tripId)));
  const candidates = await rankedCandidates(vehicleTypeId, pickup, radiusKm);

  for (const candidate of candidates) {
    if (alreadyOffered.has(candidate.driverId)) {
      continue;
    }
    const locked = await redis.set(driverLockKey(candidate.driverId), tripId, "EX", lockTtlS, "NX");
    if (locked === "OK") {
      return candidate;
    }
  }

  return null;
}

async function offerToDriver(trip: Trip, candidate: RankedCandidate, timeoutS: number): Promise<void> {
  await redis.sadd(offeredSetKey(trip.id), candidate.driverId);
  await redis.set(currentDriverKey(trip.id), candidate.driverId, "EX", timeoutS + 30);

  emitToUser(candidate.driverId, "trip:request", {
    trip: {
      id: trip.id,
      pickupAddress: trip.pickupAddress,
      dropAddress: trip.dropAddress,
      distanceM: trip.distanceM,
      durationS: trip.durationS,
      paymentMethod: trip.paymentMethod,
    },
    fareEstimate: trip.fareBreakdown,
    pickupDistance: candidate.distanceM,
    expiresAt: new Date(Date.now() + timeoutS * 1000).toISOString(),
  });

  sendPushToUser(candidate.driverId, {
    title: "New ride request",
    body: trip.pickupAddress ? `Pickup: ${trip.pickupAddress}` : "New trip nearby",
    data: { tripId: trip.id, type: "trip_request" },
  }).catch((err: unknown) => {
    logger.warn({ err, tripId: trip.id, driverId: candidate.driverId }, "trip request push failed");
  });

  await scheduleDispatchTimeout(trip.id, candidate.driverId, timeoutS * 1000);
}

async function finalizeNoDriversFound(tripId: string): Promise<void> {
  const trip = await transitionTrip(tripId, "exhaust_drivers");
  await clearDispatchState(tripId);
  emitToUser(trip.riderId, "trip:no_drivers", { tripId });
}

/**
 * Single dispatch attempt: search the current radius, expanding once if the
 * first pass finds nobody, offer to the nearest available candidate, or
 * finalize as no_drivers_found if the expanded pass also comes up empty.
 * Called after trip creation and again on every reject/timeout cascade.
 */
export async function attemptDispatch(tripId: string): Promise<void> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip || trip.status !== "searching") {
    return;
  }

  const pickup = await getTripPickupPoint(tripId);
  if (!pickup) {
    logger.error({ tripId }, "dispatch attempted with no pickup point set on the trip");
    return;
  }

  const baseRadius = await getConfigValue("dispatch_radius_km", 5);
  const timeoutS = await getConfigValue("dispatch_timeout_s", 15);
  const lockTtlS = timeoutS + 5;

  const storedRadius = await redis.get(radiusKey(tripId));
  let radius = storedRadius ? Number(storedRadius) : baseRadius;
  if (!storedRadius) {
    await redis.set(radiusKey(tripId), radius);
  }

  let candidate = await findAndLockNextCandidate(tripId, trip.vehicleTypeId, pickup, radius, lockTtlS);

  if (!candidate) {
    const alreadyExpanded = await redis.get(expandedKey(tripId));
    if (!alreadyExpanded) {
      radius *= 2;
      await redis.set(radiusKey(tripId), radius);
      await redis.set(expandedKey(tripId), "1");
      candidate = await findAndLockNextCandidate(tripId, trip.vehicleTypeId, pickup, radius, lockTtlS);
    }
  }

  if (!candidate) {
    await finalizeNoDriversFound(tripId);
    return;
  }

  await offerToDriver(trip, candidate, timeoutS);
}

/** Creates the trip and kicks off the first dispatch attempt. */
export async function requestTrip(riderId: string, input: CreateTripInput) {
  const trip = await createTripRecord(riderId, input);
  await transitionTrip(trip.id, "dispatch");
  await attemptDispatch(trip.id);
  return prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
}

/** Called by jobs/dispatchTimeout.ts when an offer's dispatch_timeout_s elapses with no response. */
export async function handleDispatchTimeout(tripId: string, driverId: string): Promise<void> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip || trip.status !== "searching") {
    return;
  }

  const current = await redis.get(currentDriverKey(tripId));
  if (current !== driverId) {
    return; // stale timeout — the offer already moved on
  }

  await redis.del(driverLockKey(driverId));
  emitToUser(driverId, "trip:request_expired", { tripId });
  await attemptDispatch(tripId);
}

/** Called by the trip:driver_response socket event. */
export async function handleDriverResponse(tripId: string, driverId: string, accept: boolean): Promise<void> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip || trip.status !== "searching") {
    return;
  }

  const current = await redis.get(currentDriverKey(tripId));
  if (current !== driverId) {
    return; // not the currently active offer — ignore
  }

  if (!accept) {
    await redis.del(driverLockKey(driverId));
    await attemptDispatch(tripId);
    return;
  }

  // First-accept-wins: atomically claim the offer so a racing timeout can't
  // also process it.
  const claimed = await redis.getdel(currentDriverKey(tripId));
  if (claimed !== driverId) {
    return;
  }

  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId: driverId },
    include: { currentVehicle: { include: { vehicleType: true } } },
  });

  const updatedTrip = await transitionTrip(tripId, "driver_accept", {
    driverId,
    vehicleId: driverProfile?.vehicleId ?? null,
  });

  await redis.del(driverLockKey(driverId));
  await redis.del(offeredSetKey(tripId));

  // Busy with this trip now — pulled from the live GEO index. Re-added by
  // trips/service.ts:completeTrip once they drop the rider off.
  if (driverProfile?.currentVehicle) {
    await redis.zrem(geoSetKey(driverProfile.currentVehicle.vehicleTypeId), driverId);
  }

  joinTripRoom(trip.riderId, tripId);
  joinTripRoom(driverId, tripId);

  const [driverState, pickup, driverUser] = await Promise.all([
    getDriverState(driverId),
    getTripPickupPoint(tripId),
    prisma.user.findUnique({ where: { id: driverId }, select: { id: true, name: true, phone: true } }),
  ]);

  let etaS: number | null = null;
  if (driverState && pickup) {
    const route = await getRoute({ lat: driverState.lat, lng: driverState.lng }, pickup);
    etaS = route?.durationS ?? null;
  }

  emitToUser(trip.riderId, "trip:accepted", {
    trip: { id: updatedTrip.id, status: updatedTrip.status, otp: updatedTrip.otp },
    driver: driverUser,
    vehicle: driverProfile?.currentVehicle,
    eta: etaS,
  });
}
