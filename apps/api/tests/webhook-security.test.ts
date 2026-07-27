import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { env } from "../src/config/env.js";
import { PaystackGateway } from "../src/modules/payments/paystack.gateway.js";

describe("Paystack webhook signature verification (Phase 5.2)", () => {
  const originalKey = env.PAYSTACK_SECRET_KEY;

  beforeAll(() => {
    env.PAYSTACK_SECRET_KEY = "test-paystack-secret";
  });

  afterAll(() => {
    env.PAYSTACK_SECRET_KEY = originalKey;
  });

  function sign(payload: Buffer): string {
    return createHmac("sha512", env.PAYSTACK_SECRET_KEY).update(payload).digest("hex");
  }

  it("accepts a correctly signed payload", () => {
    const gateway = new PaystackGateway();
    const payload = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "r1" } }));
    const result = gateway.verifyWebhook(payload, sign(payload));
    expect(result.valid).toBe(true);
  });

  it("rejects a payload that doesn't match its signature", () => {
    const gateway = new PaystackGateway();
    const payload = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "r1" } }));
    const tamperedPayload = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "r2" } }));
    const result = gateway.verifyWebhook(tamperedPayload, sign(payload));
    expect(result.valid).toBe(false);
  });

  // Regression test for the constant-time-compare fix: node's
  // timingSafeEqual throws on mismatched buffer lengths rather than
  // returning false, so the length check ahead of it must catch this case
  // itself rather than letting the exception escape.
  it("rejects a signature of the wrong length without throwing", () => {
    const gateway = new PaystackGateway();
    const payload = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "r1" } }));
    expect(() => gateway.verifyWebhook(payload, "too-short")).not.toThrow();
    expect(gateway.verifyWebhook(payload, "too-short").valid).toBe(false);
  });
});
