import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../shared/redis.js";
import { TooManyRequestsError } from "../shared/errors.js";

type RedisReply = boolean | number | string | (boolean | number | string)[];

/**
 * Shared Redis-backed store so limits are enforced consistently across
 * however many API processes are running, not per-process in memory.
 */
function redisStore(prefix: string): RedisStore {
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => {
      const [command, ...rest] = args as [string, ...string[]];
      return redis.call(command, ...rest) as Promise<RedisReply>;
    },
  });
}

/**
 * Applied ahead of every /api/v1 route (see app.ts) as a coarse defense
 * against generic abuse/scraping. Deliberately generous — per-route limiters
 * below exist for the endpoints that actually need tighter limits.
 */
export const globalRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("rl:global:"),
  handler: () => {
    throw new TooManyRequestsError("Too many requests, slow down");
  },
});

/**
 * IP-based limiter for auth endpoints (OTP request/verify, refresh, staff
 * login) — defense in depth alongside otp.ts's own phone-keyed limiter,
 * which only throttles a single phone number and does nothing against an
 * attacker rotating through many numbers from one IP.
 */
export const authRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("rl:auth:"),
  handler: () => {
    throw new TooManyRequestsError("Too many requests, slow down");
  },
});
