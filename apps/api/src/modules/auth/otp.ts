import { randomInt } from "node:crypto";
import { redis } from "../../shared/redis.js";
import { getConfigValue } from "../../shared/config.js";
import { logger } from "../../shared/logger.js";
import { env } from "../../config/env.js";
import { TooManyRequestsError } from "../../shared/errors.js";

const OTP_TTL_S = 5 * 60;
const RATE_LIMIT_WINDOW_S = 60;
const RATE_LIMIT_MAX_REQUESTS = 3;
const MAX_VERIFY_ATTEMPTS = 5;
const LOCKOUT_WINDOW_S = 15 * 60;

function otpKey(phone: string): string {
  return `otp:${phone}`;
}

function rateLimitKey(phone: string): string {
  return `otp:rate:${phone}`;
}

function verifyAttemptsKey(phone: string): string {
  return `otp:verify_attempts:${phone}`;
}

/**
 * Generates and stores an OTP for `phone` (5-min TTL, rate-limited to
 * RATE_LIMIT_MAX_REQUESTS per RATE_LIMIT_WINDOW_S). In non-production
 * environments the OTP is logged instead of sent via SMS — see docs/plan.md
 * Section 9 for wiring up a real SMS provider.
 */
export async function requestOtp(phone: string): Promise<void> {
  const attempts = await redis.incr(rateLimitKey(phone));
  if (attempts === 1) {
    await redis.expire(rateLimitKey(phone), RATE_LIMIT_WINDOW_S);
  }
  if (attempts > RATE_LIMIT_MAX_REQUESTS) {
    throw new TooManyRequestsError("Too many OTP requests, try again shortly");
  }

  const length = await getConfigValue("otp_length", 4);
  const otp = String(randomInt(0, 10 ** length)).padStart(length, "0");

  await redis.set(otpKey(phone), otp, "EX", OTP_TTL_S);

  if (env.NODE_ENV !== "production") {
    logger.info({ phone, otp }, "OTP generated (dev only — not sent via SMS)");
  }
}

/**
 * Verifies `otp` against the stored value for `phone`. Consumes the OTP on
 * success (single use) so it cannot be replayed.
 *
 * Brute-force lockout (Phase 5.2): every verify call — right or wrong —
 * counts against a per-phone attempt counter with its own
 * LOCKOUT_WINDOW_S TTL, independent of the OTP's own 5-min TTL and of
 * requestOtp's request-rate limiter above (that one throttles *requesting*
 * codes; this throttles *guessing* one). A short numeric OTP has few enough
 * possibilities that unlimited verify attempts within its TTL would make it
 * brute-forceable. The counter is cleared on a successful verify so it
 * never penalizes a later, legitimate login.
 */
export async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  const attemptsKeyName = verifyAttemptsKey(phone);
  const attempts = await redis.incr(attemptsKeyName);
  if (attempts === 1) {
    await redis.expire(attemptsKeyName, LOCKOUT_WINDOW_S);
  }
  if (attempts > MAX_VERIFY_ATTEMPTS) {
    throw new TooManyRequestsError("Too many incorrect attempts — request a new code");
  }

  const stored = await redis.get(otpKey(phone));
  if (!stored || stored !== otp) {
    return false;
  }
  await redis.del(otpKey(phone));
  await redis.del(attemptsKeyName);
  return true;
}
