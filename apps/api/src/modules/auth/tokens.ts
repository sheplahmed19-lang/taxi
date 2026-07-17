import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../db/index.js";
import { env } from "../../config/env.js";
import type { AuthUser } from "../../middleware/auth.js";

export type AccessTokenPayload = AuthUser;

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_DAYS = 30;

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refreshExpiry(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Issues a brand-new refresh token for a user (e.g. at login), stored hashed. */
export async function issueRefreshToken(userId: string): Promise<string> {
  const token = randomBytes(48).toString("hex");
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: refreshExpiry() },
  });
  return token;
}

/**
 * Rotates a refresh token: the presented token is revoked and a new one is
 * issued in the same transaction. Returns null if the token is unknown,
 * already revoked, or expired. See CLAUDE.md — refresh tokens are always
 * rotated and stored hashed, never in plaintext.
 */
export async function rotateRefreshToken(
  presentedToken: string,
): Promise<{ userId: string; role: AuthUser["role"]; token: string } | null> {
  const tokenHash = hashToken(presentedToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    return null;
  }

  const newToken = randomBytes(48).toString("hex");

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: { userId: existing.userId, tokenHash: hashToken(newToken), expiresAt: refreshExpiry() },
    }),
  ]);

  return { userId: existing.userId, role: existing.user.role, token: newToken };
}
