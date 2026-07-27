// drivers module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { redis } from "../../shared/redis.js";
import { uploadObject, getSignedObjectUrl } from "../../shared/storage.js";
import { getConfigValue } from "../../shared/config.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { haversineMeters } from "../../shared/maps.js";
import { logger } from "../../shared/logger.js";

export interface RegisterDriverInput {
  name?: string;
  email?: string;
  vehicleTypeId: string;
  plate: string;
  model?: string;
  color?: string;
  year?: number;
}

/**
 * Driver in-app registration: personal info (merged into the User row),
 * vehicle info (new Vehicle), and a DriverProfile reset to `pending`
 * verification. Documents are uploaded separately via uploadDriverDocument.
 */
export async function registerDriver(userId: string, data: RegisterDriverInput) {
  return prisma.$transaction(async (tx) => {
    if (data.name !== undefined || data.email !== undefined) {
      await tx.user.update({
        where: { id: userId },
        data: { name: data.name, email: data.email },
      });
    }

    // DriverProfile must exist before Vehicle.driverId can reference it.
    await tx.driverProfile.upsert({
      where: { userId },
      update: { verificationStatus: "pending", rejectionReason: null },
      create: { userId, verificationStatus: "pending" },
    });

    const vehicle = await tx.vehicle.create({
      data: {
        driverId: userId,
        vehicleTypeId: data.vehicleTypeId,
        plate: data.plate,
        model: data.model,
        color: data.color,
        year: data.year,
      },
    });

    return tx.driverProfile.update({
      where: { userId },
      data: { vehicleId: vehicle.id },
      include: { currentVehicle: true },
    });
  });
}

export async function uploadDriverDocument(
  userId: string,
  docType: string,
  file: { buffer: Buffer; mimetype: string; originalname: string },
) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new NotFoundError("Driver profile not found — register first");
  }

  const { key } = await uploadObject(`driver-documents/${userId}`, file);
  const documents = { ...((profile.documents as Record<string, string> | null) ?? {}), [docType]: key };

  return prisma.driverProfile.update({
    where: { userId },
    data: { documents },
  });
}

export async function getDriverProfile(userId: string) {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    include: { currentVehicle: { include: { vehicleType: true } } },
  });
  if (!profile) {
    throw new NotFoundError("Driver profile not found");
  }
  return profile;
}

// Exported so dispatch/service.ts can search/lock the same Redis GEO sets
// without duplicating the key convention.
export function geoSetKey(vehicleTypeId: string): string {
  return `drivers:online:${vehicleTypeId}`;
}

export function stateKey(driverId: string): string {
  return `driver:${driverId}:state`;
}

export interface DriverState {
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  ts: number;
  vehicleTypeId: string;
}

export async function getDriverState(driverId: string): Promise<DriverState | null> {
  const state = await redis.hgetall(stateKey(driverId));
  if (!state.lat || !state.lng) {
    return null;
  }
  return {
    lat: parseFloat(state.lat),
    lng: parseFloat(state.lng),
    heading: parseFloat(state.heading ?? "0"),
    speed: parseFloat(state.speed ?? "0"),
    ts: parseInt(state.ts ?? "0", 10),
    vehicleTypeId: state.vehicleTypeId ?? "",
  };
}

async function canGoOnline(driverId: string, verificationStatus: string): Promise<{ allowed: boolean; reason?: string }> {
  if (verificationStatus !== "approved") {
    return { allowed: false, reason: "Driver is not verified" };
  }

  const oweThreshold = await getConfigValue("owe_block_threshold", 10000);
  const owe = await prisma.oweAmount.findUnique({ where: { driverId } });
  if (owe && owe.amount > oweThreshold) {
    return { allowed: false, reason: "Outstanding balance exceeds the allowed threshold — settle your owe amount first" };
  }

  return { allowed: true };
}

/**
 * Toggles online/offline. Going online is blocked if the driver isn't
 * verified, has no registered vehicle, or owes more than the configured
 * threshold. Going offline removes the driver from the live GEO index.
 */
export async function setAvailability(userId: string, online: boolean) {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    include: { currentVehicle: true },
  });
  if (!profile) {
    throw new NotFoundError("Driver profile not found — register first");
  }

  if (online) {
    if (!profile.currentVehicle) {
      throw new ForbiddenError("Register a vehicle before going online");
    }
    const check = await canGoOnline(userId, profile.verificationStatus);
    if (!check.allowed) {
      throw new ForbiddenError(check.reason);
    }
  } else {
    if (profile.currentVehicle) {
      await redis.zrem(geoSetKey(profile.currentVehicle.vehicleTypeId), userId);
    }
    await redis.del(stateKey(userId));
  }

  return prisma.driverProfile.update({
    where: { userId },
    data: { online },
    include: { currentVehicle: { include: { vehicleType: true } } },
  });
}

export interface DriverLocationInput {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  ts?: number;
  /** Android's mock-location-provider flag (see geolocator's Position.isMocked); always false/absent on iOS. */
  isMocked?: boolean;
}

const DEFAULT_MAX_PLAUSIBLE_SPEED_KMH = 180;
// Below this gap, GPS jitter alone can imply absurd speeds over a tiny
// distance/time — skip the check rather than false-positive on noise.
const MIN_INTERVAL_S_FOR_SPEED_CHECK = 2;

/**
 * Records a live location ping: GEOADD into the per-vehicle-type set and a
 * state hash for fast lookups. Pings from a driver who isn't marked online
 * (or has no registered vehicle) are silently ignored.
 *
 * GPS-spoof mitigations (Phase 5.2): a ping flagged `isMocked` by the device
 * is logged (not blocked outright — that's an ops/policy call, e.g. for
 * legitimate testing) so it's visible for review; a ping implying a speed
 * beyond `max_plausible_speed_kmh` (system_config, CLAUDE.md rule 10) since
 * the previous recorded ping is rejected outright rather than silently
 * teleporting the driver's live position. Returns whether the ping was
 * accepted so callers (e.g. tests) can assert on rejection.
 */
export async function recordLocation(
  userId: string,
  location: DriverLocationInput,
): Promise<{ accepted: boolean }> {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    include: { currentVehicle: true },
  });
  if (!profile?.online || !profile.currentVehicle) {
    return { accepted: false };
  }

  if (location.isMocked) {
    logger.warn({ userId }, "driver location ping flagged as mocked/simulated by device");
  }

  const now = location.ts ?? Date.now();
  const previous = await redis.hgetall(stateKey(userId));
  if (previous.lat && previous.lng && previous.ts) {
    const elapsedS = (now - Number(previous.ts)) / 1000;
    if (elapsedS >= MIN_INTERVAL_S_FOR_SPEED_CHECK) {
      const distanceM = haversineMeters(
        { lat: Number(previous.lat), lng: Number(previous.lng) },
        { lat: location.lat, lng: location.lng },
      );
      const impliedSpeedKmh = (distanceM / elapsedS) * 3.6;
      const maxSpeedKmh = await getConfigValue("max_plausible_speed_kmh", DEFAULT_MAX_PLAUSIBLE_SPEED_KMH);
      if (impliedSpeedKmh > maxSpeedKmh) {
        logger.warn(
          { userId, impliedSpeedKmh: Math.round(impliedSpeedKmh), maxSpeedKmh },
          "rejected implausible driver location jump (possible GPS spoofing)",
        );
        return { accepted: false };
      }
    }
  }

  const vehicleTypeId = profile.currentVehicle.vehicleTypeId;
  await redis.geoadd(geoSetKey(vehicleTypeId), location.lng, location.lat, userId);
  await redis.hset(stateKey(userId), {
    lat: String(location.lat),
    lng: String(location.lng),
    heading: String(location.heading ?? 0),
    speed: String(location.speed ?? 0),
    ts: String(now),
    vehicleTypeId,
  });
  return { accepted: true };
}

/** Removes a driver from the live GEO index and marks them offline in the DB. */
export async function markOffline(userId: string): Promise<void> {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    include: { currentVehicle: true },
  });
  if (!profile) {
    return;
  }

  if (profile.currentVehicle) {
    await redis.zrem(geoSetKey(profile.currentVehicle.vehicleTypeId), userId);
  }
  await redis.del(stateKey(userId));

  if (profile.online) {
    await prisma.driverProfile.update({ where: { userId }, data: { online: false } });
  }
}

export interface NearbyDriver {
  driverId: string;
  vehicleTypeId: string;
  lat: number;
  lng: number;
  heading: number;
}

/** Anonymized nearby car positions for the rider app map — no driver identity beyond a marker key. */
export async function findNearbyDrivers(
  point: { lat: number; lng: number },
  vehicleTypeId?: string,
  radiusKm?: number,
): Promise<NearbyDriver[]> {
  const radius = radiusKm ?? (await getConfigValue("dispatch_radius_km", 5));
  const vehicleTypeIds = vehicleTypeId
    ? [vehicleTypeId]
    : (await prisma.vehicleType.findMany({ where: { active: true }, select: { id: true } })).map((v) => v.id);

  const results: NearbyDriver[] = [];

  for (const vtId of vehicleTypeIds) {
    const matches = (await redis.geosearch(
      geoSetKey(vtId),
      "FROMLONLAT",
      point.lng,
      point.lat,
      "BYRADIUS",
      radius,
      "km",
      "WITHCOORD",
    )) as Array<[string, [string, string]]>;

    for (const [driverId, [lng, lat]] of matches) {
      const heading = await redis.hget(stateKey(driverId), "heading");
      results.push({
        driverId,
        vehicleTypeId: vtId,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        heading: heading ? parseFloat(heading) : 0,
      });
    }
  }

  return results;
}

/** Weekly statements (Phase 2.5) — signed download link per statement, same pattern as document/avatar URLs. */
export async function listMyStatements(driverId: string) {
  const statements = await prisma.driverStatement.findMany({
    where: { driverId },
    orderBy: { periodEnd: "desc" },
  });

  return Promise.all(
    statements.map(async (statement) => ({
      ...statement,
      downloadUrl: await getSignedObjectUrl(statement.objectKey),
    })),
  );
}

/** Dispatcher panel's statements view (Phase 4.4) — any driver, or all of them, unlike listMyStatements above. */
export async function listStatementsForAdmin(driverId?: string) {
  const statements = await prisma.driverStatement.findMany({
    where: driverId ? { driverId } : undefined,
    include: { driver: { include: { user: { select: { name: true, phone: true } } } } },
    orderBy: { periodEnd: "desc" },
    take: 200,
  });

  return Promise.all(
    statements.map(async (statement) => ({
      ...statement,
      downloadUrl: await getSignedObjectUrl(statement.objectKey),
    })),
  );
}
