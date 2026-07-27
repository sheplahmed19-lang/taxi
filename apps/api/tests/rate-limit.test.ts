import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { redis } from "../src/shared/redis.js";

const app = createApp();
const suffix = Date.now();

async function clearRateLimitKeys(): Promise<void> {
  const keys = await redis.keys("rl:*");
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

describe("rate limiting (Phase 5.2)", () => {
  beforeEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    await clearRateLimitKeys();
    await redis.quit();
  });

  it("sets standard rate-limit headers on a public v1 route", async () => {
    const res = await request(app).get("/api/v1/trips/00000000-0000-0000-0000-000000000000/track?token=x");
    expect(res.headers["ratelimit-limit"]).toBeDefined();
  });

  it("authRateLimit blocks a single IP after its per-minute limit, independent of otp.ts's own per-phone limiter", async () => {
    // Each request uses a distinct phone number so otp.ts's own 3/min
    // per-phone limiter (a completely separate mechanism) never fires —
    // this isolates the IP-based authRateLimit middleware under test.
    const responses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const phone = `+201${String(suffix).slice(-6)}${String(i).padStart(3, "0")}`;
      const res = await request(app).post("/api/v1/auth/otp/request").send({ phone });
      responses.push(res.status);
    }

    expect(responses.slice(0, 20).every((status) => status !== 429)).toBe(true);
    expect(responses[20]).toBe(429);
  });

  it("OTP verify is locked out after too many wrong-code attempts for one phone", async () => {
    const phone = `+201${String(suffix).slice(-6)}999`;
    await request(app).post("/api/v1/auth/otp/request").send({ phone });

    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post("/api/v1/auth/otp/verify").send({ phone, otp: "0000" });
      results.push(res.status);
    }

    // First 5 wrong guesses are rejected as plain invalid-OTP (400); the 6th
    // trips the lockout counter (429), regardless of the guessed code.
    expect(results.slice(0, 5).every((status) => status === 400)).toBe(true);
    expect(results[5]).toBe(429);
  });
});
