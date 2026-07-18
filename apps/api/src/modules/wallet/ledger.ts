/**
 * Double-entry ledger. ALL wallet/balance changes MUST go through postEntry()
 * inside a DB transaction with row locks (SELECT ... FOR UPDATE). See CLAUDE.md rule 3.
 *
 * This is the minimal correct version needed by Phase 1.8 (cash payment
 * close-out) — idempotent, row-locked, never lets a balance go negative.
 * Phase 2.1 hardens it further (concurrency tests, endpoint-level
 * idempotency keys, transaction history pagination).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { NotFoundError, ConflictError } from "../../shared/errors.js";

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

export interface PostEntryResult {
  entry: Awaited<ReturnType<typeof prisma.ledgerEntry.create>>;
  /** False when this call replayed an existing idempotency key — callers must skip any side effect that isn't itself idempotent (e.g. incrementing owe_amounts). */
  created: boolean;
}

export async function postEntry(input: PostEntryInput): Promise<PostEntryResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.ledgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return { entry: existing, created: false };
    }

    const locked = await tx.$queryRaw<Array<{ id: string; balance: number }>>`
      SELECT id, balance FROM wallets WHERE id = ${input.walletId} FOR UPDATE
    `;
    const wallet = locked[0];
    if (!wallet) {
      throw new NotFoundError("Wallet not found");
    }

    const balanceAfter = wallet.balance + input.credit - input.debit;
    if (balanceAfter < 0) {
      throw new ConflictError("Insufficient wallet balance");
    }

    await tx.wallet.update({ where: { id: input.walletId }, data: { balance: balanceAfter } });

    const entry = await tx.ledgerEntry.create({
      data: {
        walletId: input.walletId,
        tripId: input.tripId,
        type: input.type,
        debit: input.debit,
        credit: input.credit,
        balanceAfter,
        meta: input.meta as unknown as Prisma.InputJsonValue | undefined,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return { entry, created: true };
  });
}
