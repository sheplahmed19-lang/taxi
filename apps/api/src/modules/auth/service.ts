// auth module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import bcrypt from "bcryptjs";
import { prisma } from "../../db/index.js";
import type { AuthUser } from "../../middleware/auth.js";
import type { User } from "@prisma/client";

const BCRYPT_ROUNDS = 12;

/** Finds a rider/driver by phone, or creates one (with a wallet) on first login. */
export async function findOrCreateUserByPhone(
  phone: string,
  role: "rider" | "driver",
): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: {
      phone,
      role,
      wallet: { create: { balance: 0 } },
    },
  });
}

/** Verifies staff/admin email+password credentials. Returns null on any mismatch. */
export async function authenticateStaff(email: string, password: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    return null;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function toAuthUser(user: User): AuthUser {
  return { id: user.id, role: user.role };
}
