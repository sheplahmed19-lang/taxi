/**
 * Every payment provider (Stripe, Paystack, ...) implements this interface.
 * Webhooks must be signature-verified. See CLAUDE.md rule 5.
 */
export interface PaymentGateway {
  createIntent(input: { amount: number; currency: string; metadata?: Record<string, unknown> }): Promise<{ id: string; clientSecret?: string }>;
  capture(intentId: string): Promise<{ status: "succeeded" | "failed" }>;
  verifyWebhook(payload: Buffer, signature: string): { valid: boolean; event?: unknown };
  refund(intentId: string, amount?: number): Promise<{ status: "refunded" | "failed" }>;
}
