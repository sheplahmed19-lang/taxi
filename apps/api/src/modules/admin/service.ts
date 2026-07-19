// admin module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { redis } from "../../shared/redis.js";
import { NotFoundError } from "../../shared/errors.js";
import { logAudit } from "../../shared/auditLog.js";
import { geoSetKey, getDriverState } from "../drivers/service.js";
import { enqueueBroadcast } from "../../jobs/broadcasts.js";
import type { DriverVerificationStatus } from "@prisma/client";

/** Checks whether a user's assigned StaffRole grants the given permission key. */
export async function userHasPermission(userId: string, permissionKey: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      staffRole: {
        select: {
          rolePermissions: {
            where: { permission: { key: permissionKey } },
            select: { roleId: true },
          },
        },
      },
    },
  });

  return Boolean(user?.staffRole && user.staffRole.rolePermissions.length > 0);
}

export async function listDrivers(status?: DriverVerificationStatus) {
  return prisma.driverProfile.findMany({
    where: status ? { verificationStatus: status } : undefined,
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } },
      currentVehicle: { include: { vehicleType: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function requireDriverProfile(userId: string) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new NotFoundError("Driver not found");
  }
  return profile;
}

export async function approveDriver(userId: string) {
  await requireDriverProfile(userId);
  return prisma.driverProfile.update({
    where: { userId },
    data: { verificationStatus: "approved", rejectionReason: null },
  });
}

export async function rejectDriver(userId: string, reason: string) {
  await requireDriverProfile(userId);
  return prisma.driverProfile.update({
    where: { userId },
    data: { verificationStatus: "rejected", rejectionReason: reason },
  });
}

/** Currently-online drivers (any vehicle type) whose live GEO position falls inside the zone's polygon. */
async function resolveZoneDriverIds(zoneId: string): Promise<string[]> {
  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!zone) {
    throw new NotFoundError("Zone not found");
  }

  const vehicleTypes = await prisma.vehicleType.findMany({ select: { id: true } });
  const candidates: Array<{ driverId: string; lat: number; lng: number }> = [];
  for (const vt of vehicleTypes) {
    const onlineDriverIds = await redis.zrange(geoSetKey(vt.id), 0, -1);
    for (const driverId of onlineDriverIds) {
      const state = await getDriverState(driverId);
      if (state) {
        candidates.push({ driverId, lat: state.lat, lng: state.lng });
      }
    }
  }

  const withinZone: string[] = [];
  for (const candidate of candidates) {
    const rows = await prisma.$queryRaw<Array<{ contains: boolean }>>`
      SELECT ST_Contains(polygon, ST_SetSRID(ST_MakePoint(${candidate.lng}, ${candidate.lat}), 4326)) AS contains
      FROM zones WHERE id = ${zoneId}
    `;
    if (rows[0]?.contains) {
      withinZone.push(candidate.driverId);
    }
  }
  return withinZone;
}

export interface SendBroadcastInput {
  title: string;
  body: string;
  segment: "all_riders" | "all_drivers" | "zone";
  zoneId?: string;
}

/**
 * Resolves the segment to concrete userIds, hands the actual sending off to
 * jobs/broadcasts.ts (a segment can be thousands of users — never block the
 * admin's HTTP response on that many FCM calls), and audit-logs the action
 * (mirrors the payout/owe admin actions' AuditLog trail).
 */
export async function sendBroadcast(actorId: string, input: SendBroadcastInput): Promise<{ recipientCount: number }> {
  let userIds: string[];
  if (input.segment === "all_riders") {
    const riders = await prisma.user.findMany({ where: { role: "rider" }, select: { id: true } });
    userIds = riders.map((r) => r.id);
  } else if (input.segment === "all_drivers") {
    const drivers = await prisma.user.findMany({ where: { role: "driver" }, select: { id: true } });
    userIds = drivers.map((d) => d.id);
  } else {
    userIds = await resolveZoneDriverIds(input.zoneId!);
  }

  if (userIds.length > 0) {
    await enqueueBroadcast(userIds, input.title, input.body, { type: "broadcast", segment: input.segment });
  }

  await logAudit(actorId, "broadcast.send", "broadcast", input.segment, {
    title: input.title,
    segment: input.segment,
    zoneId: input.zoneId,
    recipientCount: userIds.length,
  });

  return { recipientCount: userIds.length };
}
