// admin module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { NotFoundError } from "../../shared/errors.js";
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
