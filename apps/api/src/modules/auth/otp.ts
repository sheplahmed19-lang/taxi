import { randomInt } from "node:crypto";
import { redis } from "../../shared/redis.js";
import { getConfigValue } from "../../shared/config.js";
import { logger } from "../../shared/logger.js";
import { env } from "../../config/env.js";
import { TooManyRequestsError } from "../../shared/errors.js";

const OTP_TTL_S = 5 * 60;
const RATE_LIMIT_WINDOW_S = 60;
const RATE_LIMIT_MAX_REQUESTS = 3;

function otpKey(phone: string): string {
  return `otp:${phone}`;
}

function rateLimitKey(phone: string): string {
  return `otp:rate:${phone}`;
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
 */
export async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  const stored = await redis.get(otpKey(phone));
  if (!stored || stored !== otp) {
    return false;
  }
  await redis.del(otpKey(phone));
  return true;
}
