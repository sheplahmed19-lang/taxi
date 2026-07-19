/**
 * Tokenized public trip-tracking links (Phase 3.4). Kept in Redis rather
 * than a Trip column: these are short-lived, purely-derived values (no
 * migration needed), and the TTL naturally expires an old share link
 * without any cleanup job.
 *
 * Deliberately dependency-free (only imports redis) so both
 * trips/service.ts and realtime/index.ts can import it directly without
 * creating the same import cycle those two files already dodge via
 * dynamic imports elsewhere.
 */
import { randomBytes } from "node:crypto";
import { redis } from "./redis.js";

function shareTokenKey(token: string): string {
  return `trip:share:${token}`;
}

export async function createTripShareToken(tripId: string, ttlHours: number): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await redis.set(shareTokenKey(token), tripId, "EX", Math.round(ttlHours * 3600));
  return token;
}

/** Returns the tripId a token was issued for, or null if it's invalid/expired. */
export async function resolveTripShareToken(token: string): Promise<string | null> {
  return redis.get(shareTokenKey(token));
}
