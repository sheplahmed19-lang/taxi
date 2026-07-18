import Stripe from "stripe";
import { env } from "../../config/env.js";
import type { PaymentGateway } from "./gateway.interface.js";

function metadataToStrings(metadata?: Record<string, unknown>): Record<string, string> | undefined {
  if (!metadata) return undefined;
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)]));
}

export class StripeGateway implements PaymentGateway {
  private client(): Stripe {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    return new Stripe(env.STRIPE_SECRET_KEY);
  }

  async createIntent(input: {
    amount: number;
    currency: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string; clientSecret?: string }> {
    const intent = await this.client().paymentIntents.create({
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      metadata: metadataToStrings(input.metadata),
      automatic_payment_methods: { enabled: true },
    });
    return { id: intent.id, clientSecret: intent.client_secret ?? undefined };
  }

  async capture(intentId: string): Promise<{ status: "succeeded" | "failed" }> {
    const intent = await this.client().paymentIntents.capture(intentId);
    return { status: intent.status === "succeeded" ? "succeeded" : "failed" };
  }

  verifyWebhook(payload: Buffer, signature: string): { valid: boolean; event?: unknown } {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      return { valid: false };
    }
    try {
      const event = this.client().webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
      return { valid: true, event };
    } catch {
      return { valid: false };
    }
  }

  async refund(intentId: string, amount?: number): Promise<{ status: "refunded" | "failed" }> {
    const refund = await this.client().refunds.create({ payment_intent: intentId, amount });
    return { status: refund.status === "succeeded" ? "refunded" : "failed" };
  }
}
