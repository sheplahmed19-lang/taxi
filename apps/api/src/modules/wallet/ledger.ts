/**
 * Double-entry ledger. ALL wallet/balance changes MUST go through postEntry()
 * inside a DB transaction with row locks (SELECT ... FOR UPDATE). See CLAUDE.md rule 3.
 * Implemented in Phase 2.1.
 */
export type LedgerEntryType =
  | "topup"
  | "ride_payment"
  | "ride_earning"
  | "commission"
  | "owe"
  | "payout"
  | "refund"
  | "promo_credit"
  | "referral_bonus"
  | "subscription_fee";

export interface PostEntryInput {
  walletId: string;
  tripId?: string;
  type: LedgerEntryType;
  debit: number;
  credit: number;
  meta?: Record<string, unknown>;
  idempotencyKey: string;
}

export async function postEntry(_input: PostEntryInput): Promise<void> {
  throw new Error("postEntry not yet implemented — see docs/plan.md Phase 2.1");
}
