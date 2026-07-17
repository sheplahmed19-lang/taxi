import { prisma } from "../db/index.js";

/**
 * Reads tunable platform parameters (fares, commission %, dispatch radius,
 * OTP length, timeouts, ...) from the system_config table. See CLAUDE.md rule 10 —
 * these values must never be hardcoded in application code.
 */
const cache = new Map<string, { value: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

export async function getConfigValue<T>(key: string, fallback: T): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const row = await prisma.systemConfig.findUnique({ where: { key } });
  const value = row ? (row.value as T) : fallback;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
