// users module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { getSignedObjectUrl, uploadObject } from "../../shared/storage.js";
import { NotFoundError } from "../../shared/errors.js";

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
