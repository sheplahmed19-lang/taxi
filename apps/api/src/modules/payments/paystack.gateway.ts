import { createHmac } from "node:crypto";
import { env } from "../../config/env.js";
import { ValidationError } from "../../shared/errors.js";
import type { PaymentGateway } from "./gateway.interface.js";

const BASE_URL = "https://api.paystack.co";

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data?: { authorization_url: string; access_code: string; reference: string };
}

interface PaystackVerifyResponse {
  status: boolean;
  data?: { status: string };
}

interface PaystackRefundResponse {
  status: boolean;
  data?: { status: string };
}

function metadataToStrings(metadata?: Record<string, unknown>): Record<string, string> {
  if (!metadata) return {};
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)]));
}

/**
 * Paystack's REST API is simple enough not to need an SDK dependency — same
 * approach as shared/maps.ts's direct fetch() calls to Google Directions.
 */
export class PaystackGateway implements PaymentGateway {
  private secretKey(): string {
    if (!env.PAYSTACK_SECRET_KEY) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured");
    }
    return env.PAYSTACK_SECRET_KEY;
  }

  async createIntent(input: {
    amount: number;
    currency: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string; clientSecret?: string; redirectUrl?: string }> {
    const metadata = metadataToStrings(input.metadata);
    // Paystack's "initialize transaction" requires an email to send the
    // receipt/checkout link to — our generic createIntent() input doesn't
    // carry one, so callers pass it through metadata.email (see
    // payments/service.ts, which is the only caller and always sets it
    // when routing a charge through this gateway).
    const email = metadata.email;
    if (!email) {
      throw new ValidationError("Paystack requires a customer email (pass it via metadata.email)");
    }

    const response = await fetch(`${BASE_URL}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        metadata,
      }),
    });

    const body = (await response.json()) as PaystackInitializeResponse;
    if (!response.ok || !body.status || !body.data) {
      throw new Error(`Paystack initialize failed: ${body.message ?? response.statusText}`);
    }

    return { id: body.data.reference, redirectUrl: body.data.authorization_url };
  }

  async capture(intentId: string): Promise<{ status: "succeeded" | "failed" }> {
    // Paystack doesn't have a separate manual-capture step for standard
    // card charges (payment completes when the customer finishes the
    // hosted checkout) — this verifies the transaction instead, giving
    // capture() the same "did the money actually move" meaning it has
    // for the Stripe adapter.
    const response = await fetch(`${BASE_URL}/transaction/verify/${encodeURIComponent(intentId)}`, {
      headers: { Authorization: `Bearer ${this.secretKey()}` },
    });
    const body = (await response.json()) as PaystackVerifyResponse;
    const succeeded = response.ok && body.status && body.data?.status === "success";
    return { status: succeeded ? "succeeded" : "failed" };
  }

  verifyWebhook(payload: Buffer, signature: string): { valid: boolean; event?: unknown } {
    if (!env.PAYSTACK_SECRET_KEY) {
      return { valid: false };
    }
    const expected = createHmac("sha512", env.PAYSTACK_SECRET_KEY).update(payload).digest("hex");
    if (expected !== signature) {
      return { valid: false };
    }
    try {
      return { valid: true, event: JSON.parse(payload.toString("utf8")) };
    } catch {
      return { valid: false };
    }
  }

  async refund(intentId: string, amount?: number): Promise<{ status: "refunded" | "failed" }> {
    const response = await fetch(`${BASE_URL}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transaction: intentId, ...(amount ? { amount } : {}) }),
    });
    const body = (await response.json()) as PaystackRefundResponse;
    const refunded = response.ok && body.status;
    return { status: refunded ? "refunded" : "failed" };
  }
}
