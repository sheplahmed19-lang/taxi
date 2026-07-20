// users module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import type { Prisma, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { getSignedObjectUrl, uploadObject } from "../../shared/storage.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { logAudit } from "../../shared/auditLog.js";
import { hashPassword } from "../auth/service.js";

const PROFILE_SELECT = {
  id: true,
  phone: true,
  email: true,
  name: true,
  avatar: true,
  role: true,
  status: true,
  referralCode: true,
  createdAt: true,
} as const;

async function withAvatarUrl<T extends { avatar: string | null }>(
  user: T,
): Promise<T & { avatarUrl: string | null }> {
  const avatarUrl = user.avatar ? await getSignedObjectUrl(user.avatar) : null;
  return { ...user, avatarUrl };
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: PROFILE_SELECT,
  });
  return withAvatarUrl(user);
}

export async function updateProfile(userId: string, data: { name?: string; email?: string }) {
  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: PROFILE_SELECT,
  });
  return withAvatarUrl(user);
}

export async function updateAvatar(
  userId: string,
  file: { buffer: Buffer; mimetype: string; originalname: string },
) {
  const { key } = await uploadObject(`avatars/${userId}`, file);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatar: key },
    select: PROFILE_SELECT,
  });
  return withAvatarUrl(user);
}

export async function listFavorites(userId: string) {
  return prisma.$queryRaw<
    Array<{ id: string; label: string; address: string | null; lat: number | null; lng: number | null }>
  >`
    SELECT id, label, address, ST_Y(point) AS lat, ST_X(point) AS lng
    FROM favorite_locations
    WHERE user_id = ${userId}
    ORDER BY label
  `;
}

export async function createFavorite(
  userId: string,
  data: { label: string; lat: number; lng: number; address?: string },
) {
  const favorite = await prisma.favoriteLocation.create({
    data: { userId, label: data.label, address: data.address },
  });

  await prisma.$executeRaw`
    UPDATE favorite_locations
    SET point = ST_SetSRID(ST_MakePoint(${data.lng}, ${data.lat}), 4326)
    WHERE id = ${favorite.id}
  `;

  return { ...favorite, lat: data.lat, lng: data.lng };
}

export async function updateFavorite(
  userId: string,
  id: string,
  data: { label?: string; lat?: number; lng?: number; address?: string },
) {
  const existing = await prisma.favoriteLocation.findFirst({ where: { id, userId } });
  if (!existing) {
    throw new NotFoundError("Favorite location not found");
  }

  if (data.label !== undefined || data.address !== undefined) {
    await prisma.favoriteLocation.update({
      where: { id },
      data: { label: data.label, address: data.address },
    });
  }

  if (data.lat !== undefined && data.lng !== undefined) {
    await prisma.$executeRaw`
      UPDATE favorite_locations
      SET point = ST_SetSRID(ST_MakePoint(${data.lng}, ${data.lat}), 4326)
      WHERE id = ${id}
    `;
  }

  const [updated] = await listFavoriteById(id);
  return updated;
}

async function listFavoriteById(id: string) {
  return prisma.$queryRaw<
    Array<{ id: string; label: string; address: string | null; lat: number | null; lng: number | null }>
  >`
    SELECT id, label, address, ST_Y(point) AS lat, ST_X(point) AS lng
    FROM favorite_locations
    WHERE id = ${id}
  `;
}

export async function deleteFavorite(userId: string, id: string): Promise<void> {
  const existing = await prisma.favoriteLocation.findFirst({ where: { id, userId } });
  if (!existing) {
    throw new NotFoundError("Favorite location not found");
  }
  await prisma.favoriteLocation.delete({ where: { id } });
}

/**
 * Registers an FCM device token for push notifications. Upserts by token
 * (unique) so re-registering the same device — including after a different
 * user logs in on it — reassigns it rather than erroring.
 */
export async function registerDeviceToken(
  userId: string,
  token: string,
  platform?: "ios" | "android" | "web",
) {
  return prisma.deviceToken.upsert({
    where: { token },
    update: { userId, platform },
    create: { userId, token, platform },
  });
}

// ── Admin user management (Phase 4.2) ──────────────────────────────────────

const ADMIN_USER_SELECT = {
  id: true,
  phone: true,
  email: true,
  name: true,
  role: true,
  status: true,
  staffRoleId: true,
  staffRole: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export interface AdminListUsersQuery {
  role?: UserRole;
  status?: UserStatus;
  search?: string;
}

/** Rider/driver rows are included too (an admin does need to look up any account), not just staff-type roles. */
export async function adminListUsers(query: AdminListUsersQuery) {
  return prisma.user.findMany({
    where: {
      role: query.role,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { phone: { contains: query.search, mode: "insensitive" as const } },
              { email: { contains: query.search, mode: "insensitive" as const } },
              { name: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: ADMIN_USER_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export interface CreateStaffUserInput {
  phone: string;
  email: string;
  password: string;
  name: string;
  role: "staff" | "admin" | "fleet_owner" | "dispatcher";
  staffRoleId?: string;
}

/** Staff/admin/fleet_owner/dispatcher accounts are created here (email+password), never via the rider/driver OTP signup path. */
export async function createStaffUser(actorId: string, input: CreateStaffUserInput) {
  const [existingPhone, existingEmail] = await Promise.all([
    prisma.user.findUnique({ where: { phone: input.phone } }),
    prisma.user.findUnique({ where: { email: input.email } }),
  ]);
  if (existingPhone) {
    throw new ConflictError("A user with this phone number already exists");
  }
  if (existingEmail) {
    throw new ConflictError("A user with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      phone: input.phone,
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash,
      staffRoleId: input.staffRoleId,
    },
    select: ADMIN_USER_SELECT,
  });

  await logAudit(actorId, "user.create", "user", user.id, { role: input.role, email: input.email });
  return user;
}

async function requireUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new NotFoundError("User not found");
  }
  return user;
}

export interface AdminUpdateUserInput {
  name?: string;
  email?: string;
  staffRoleId?: string | null;
}

export async function adminUpdateUser(actorId: string, userId: string, data: AdminUpdateUserInput) {
  await requireUser(userId);
  const user = await prisma.user.update({
    where: { id: userId },
    data: data as Prisma.UserUpdateInput,
    select: ADMIN_USER_SELECT,
  });

  if (data.staffRoleId !== undefined) {
    await logAudit(actorId, "user.role_assign", "user", userId, { staffRoleId: data.staffRoleId });
  }
  return user;
}

export async function setUserStatus(actorId: string, userId: string, status: UserStatus) {
  await requireUser(userId);
  const user = await prisma.user.update({ where: { id: userId }, data: { status }, select: ADMIN_USER_SELECT });
  await logAudit(actorId, "user.status_change", "user", userId, { status });
  return user;
}
