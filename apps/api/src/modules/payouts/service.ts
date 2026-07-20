// payouts module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { randomUUID } from "node:crypto";
import { prisma } from "../../db/index.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { logAudit } from "../../shared/auditLog.js";
import { postEntry } from "../wallet/ledger.js";

/**
 * Reserves the payout amount out of the driver's wallet immediately (not
 * at approval time) — otherwise nothing stops a driver requesting several
 * payouts that together exceed their balance while the first is still
 * pending review. postEntry's own row-locked negative-balance rejection is
 * what actually enforces this; the id is generated up front so it can
 * double as the ledger idempotency key, and the Payout row is only created
 * once the debit has actually succeeded.
 */
export async function requestPayout(driverId: string, amount: number) {
  const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
  if (!wallet) {
    throw new NotFoundError("Wallet not found");
  }

  const payoutId = randomUUID();
  try {
    await postEntry({
      walletId: wallet.id,
      type: "payout",
      debit: amount,
      credit: 0,
      idempotencyKey: `payout:${payoutId}`,
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      throw new ConflictError("Insufficient wallet balance for this payout");
    }
    throw err;
  }

  return prisma.payout.create({
    data: { id: payoutId, driverId, amount, status: "requested" },
  });
}

export async function listMyPayouts(driverId: string) {
  return prisma.payout.findMany({ where: { driverId }, orderBy: { createdAt: "desc" } });
}

export async function listPayouts(status?: "requested" | "approved" | "paid" | "rejected") {
  return prisma.payout.findMany({
    where: status ? { status } : undefined,
    include: { driver: { include: { user: { select: { name: true, phone: true } } } } },
    orderBy: { createdAt: "desc" },
  });
}

async function getPayoutOrThrow(payoutId: string) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) {
    throw new NotFoundError("Payout not found");
  }
  return payout;
}

export async function approvePayout(payoutId: string, actorId: string) {
  const payout = await getPayoutOrThrow(payoutId);
  if (payout.status !== "requested") {
    throw new ConflictError(`Cannot approve a payout in status "${payout.status}"`);
  }

  const updated = await prisma.payout.update({
    where: { id: payoutId },
    data: { status: "approved", processedBy: actorId },
  });
  await logAudit(actorId, "payout.approve", "payout", payoutId, { amount: payout.amount, driverId: payout.driverId });
  return updated;
}

/** Refunds the reserved amount back to the driver's wallet — the debit at request time is reversed, not left stranded. */
export async function rejectPayout(payoutId: string, actorId: string, reason: string) {
  const payout = await getPayoutOrThrow(payoutId);
  if (payout.status !== "requested" && payout.status !== "approved") {
    throw new ConflictError(`Cannot reject a payout in status "${payout.status}"`);
  }

  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: payout.driverId } });
  await postEntry({
    walletId: wallet.id,
    type: "refund",
    debit: 0,
    credit: payout.amount,
    meta: { payoutId },
    idempotencyKey: `payout:${payoutId}:refund`,
  });

  const updated = await prisma.payout.update({
    where: { id: payoutId },
    data: { status: "rejected", rejectionReason: reason, processedBy: actorId },
  });
  await logAudit(actorId, "payout.reject", "payout", payoutId, { amount: payout.amount, driverId: payout.driverId, reason });
  return updated;
}

/** Manual transfer v1 — the money already left the platform's books at request time; this just records that it was actually sent. */
export async function markPayoutPaid(payoutId: string, actorId: string, method: string) {
  const payout = await getPayoutOrThrow(payoutId);
  if (payout.status !== "approved") {
    throw new ConflictError(`Cannot mark a payout "${payout.status}" as paid — it must be approved first`);
  }

  const updated = await prisma.payout.update({
    where: { id: payoutId },
    data: { status: "paid", method, processedBy: actorId },
  });
  await logAudit(actorId, "payout.mark_paid", "payout", payoutId, { amount: payout.amount, driverId: payout.driverId, method });
  return updated;
}
