/**
 * Every payment provider (Stripe, Paystack, ...) implements this interface.
 * Webhooks must be signature-verified. See CLAUDE.md rule 5.
 */
export interface PaymentGateway {
  /**
   * `clientSecret` is Stripe-specific (confirmed client-side via PaymentSheet
   * using the raw intent id + secret). `redirectUrl` is Paystack's
   * equivalent — Paystack's "initialize transaction" flow hands back a
   * hosted checkout URL the client opens instead. A gateway sets whichever
   * one its own client flow needs; callers should render whichever is
   * present rather than assuming a specific one.
   */
  createIntent(input: {
    amount: number;
    currency: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string; clientSecret?: string; redirectUrl?: string }>;
  capture(intentId: string): Promise<{ status: "succeeded" | "failed" }>;
  verifyWebhook(payload: Buffer, signature: string): { valid: boolean; event?: unknown };
  refund(intentId: string, amount?: number): Promise<{ status: "refunded" | "failed" }>;
}
