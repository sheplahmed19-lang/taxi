import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { redis } from "../src/shared/redis.js";
import { requestOtp, verifyOtp } from "../src/modules/auth/otp.js";

const phone = "+201000099999";

async function clearOtpState(): Promise<void> {
  await redis.del(`otp:${phone}`, `otp:rate:${phone}`);
}

describe("otp", () => {
  beforeEach(async () => {
    await clearOtpState();
  });

  afterAll(async () => {
    await clearOtpState();
    redis.disconnect();
  });

  it("stores a single-use OTP with a ~5 minute TTL", async () => {
    await requestOtp(phone);

    const ttl = await redis.ttl(`otp:${phone}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it("verifies the correct OTP once, then rejects replay", async () => {
    await requestOtp(phone);
    const stored = await redis.get(`otp:${phone}`);

    await expect(verifyOtp(phone, stored!)).resolves.toBe(true);
    await expect(verifyOtp(phone, stored!)).resolves.toBe(false);
  });

  it("rejects a wrong code", async () => {
    await requestOtp(phone);
    await expect(verifyOtp(phone, "000000")).resolves.toBe(false);
  });

  it("treats an expired (evicted) OTP as invalid", async () => {
    await requestOtp(phone);
    // Simulate TTL expiry directly rather than waiting 5 real minutes.
    await redis.del(`otp:${phone}`);

    await expect(verifyOtp(phone, "0000")).resolves.toBe(false);
  });

  it("rate-limits repeated requests for the same phone", async () => {
    await requestOtp(phone);
    await requestOtp(phone);
    await requestOtp(phone);

    await expect(requestOtp(phone)).rejects.toThrow(/too many/i);
  });
});
