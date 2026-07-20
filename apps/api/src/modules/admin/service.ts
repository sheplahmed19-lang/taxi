// admin module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { redis } from "../../shared/redis.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { logAudit } from "../../shared/auditLog.js";
import { getSignedObjectUrl } from "../../shared/storage.js";
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

/** Driver verification queue's document viewer: signed, time-limited URLs for whatever the driver has uploaded so far. */
export async function getDriverDocuments(userId: string): Promise<Array<{ type: string; url: string }>> {
  const profile = await requireDriverProfile(userId);
  const documents = (profile.documents as Record<string, string> | null) ?? {};
  return Promise.all(
    Object.entries(documents).map(async ([type, key]) => ({ type, url: await getSignedObjectUrl(key) })),
  );
}

const START_OF_TODAY = (): Date => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

export interface DashboardStats {
  tripsToday: number;
  revenueToday: number;
  activeDrivers: number;
  completionRate: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const startOfToday = START_OF_TODAY();

  const [tripsToday, completedToday, revenueAgg, activeDrivers] = await Promise.all([
    prisma.trip.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.trip.count({ where: { createdAt: { gte: startOfToday }, status: { in: ["completed", "paid"] } } }),
    prisma.trip.aggregate({
      where: { paidAt: { gte: startOfToday }, paymentStatus: "paid" },
      _sum: { fareTotal: true },
    }),
    prisma.driverProfile.count({ where: { online: true } }),
  ]);

  return {
    tripsToday,
    revenueToday: revenueAgg._sum.fareTotal ?? 0,
    activeDrivers,
    completionRate: tripsToday > 0 ? Math.round((completedToday / tripsToday) * 1000) / 10 : 0,
  };
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

// ── Roles & permissions (Phase 4.2) ─────────────────────────────────────────
// CRUD only — this populates StaffRole/Permission/RolePermission data.
// requirePermission() gates are not yet wired into any route (see CLAUDE.md).

export async function listPermissions() {
  return prisma.permission.findMany({ orderBy: { key: "asc" } });
}

export async function listRoles() {
  return prisma.staffRole.findMany({
    include: { rolePermissions: { include: { permission: true } } },
    orderBy: { name: "asc" },
  });
}

export interface RoleInput {
  name: string;
  description?: string;
  permissionIds: string[];
}

export async function createRole(input: RoleInput) {
  return prisma.staffRole.create({
    data: {
      name: input.name,
      description: input.description,
      rolePermissions: { create: input.permissionIds.map((permissionId) => ({ permissionId })) },
    },
    include: { rolePermissions: { include: { permission: true } } },
  });
}

export async function updateRole(id: string, input: Partial<RoleInput>) {
  const existing = await prisma.staffRole.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Role not found");
  }

  if (input.permissionIds) {
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      prisma.rolePermission.createMany({
        data: input.permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
      }),
    ]);
  }

  return prisma.staffRole.update({
    where: { id },
    data: { name: input.name, description: input.description },
    include: { rolePermissions: { include: { permission: true } } },
  });
}

export async function deleteRole(id: string): Promise<void> {
  const existing = await prisma.staffRole.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Role not found");
  }
  const assignedCount = await prisma.user.count({ where: { staffRoleId: id } });
  if (assignedCount > 0) {
    throw new ConflictError("This role is still assigned to one or more users");
  }
  await prisma.staffRole.delete({ where: { id } });
}
