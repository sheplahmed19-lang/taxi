import { prisma } from "../db/index.js";
import { NotFoundError } from "./errors.js";

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

/** Admin config editor (Phase 4.2) — every known tunable, in one list. */
export async function listAllConfig() {
  return prisma.systemConfig.findMany({ orderBy: { key: "asc" } });
}

/**
 * Edits an existing key only — this is an editor for the tunables the app
 * already reads by name, not a place to invent new ones nothing consumes.
 * Invalidates this key's cache entry so the change is visible immediately
 * rather than waiting out the 30s TTL.
 */
export async function setConfigValue(key: string, value: unknown) {
  const existing = await prisma.systemConfig.findUnique({ where: { key } });
  if (!existing) {
    throw new NotFoundError(`Unknown config key: ${key}`);
  }
  const row = await prisma.systemConfig.update({ where: { key }, data: { value: value as never } });
  cache.delete(key);
  return row;
}
