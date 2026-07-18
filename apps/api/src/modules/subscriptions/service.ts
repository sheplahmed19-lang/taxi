// subscriptions module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { randomUUID } from "node:crypto";
import { prisma } from "../../db/index.js";
import { redis } from "../../shared/redis.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { postEntry } from "../wallet/ledger.js";
import { cancelSubscriptionExpiry, scheduleSubscriptionExpiry } from "../../jobs/subscriptionExpiry.js";

export async function listActivePlans() {
  return prisma.subscriptionPlan.findMany({ where: { active: true }, orderBy: { price: "asc" } });
}

export async function createPlan(data: { name: string; price: number; periodDays: number }) {
  return prisma.subscriptionPlan.create({ data });
}

export async function updatePlan(
  id: string,
  data: { name?: string; price?: number; periodDays?: number; active?: boolean },
) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!plan) {
    throw new NotFoundError("Subscription plan not found");
  }
  return prisma.subscriptionPlan.update({ where: { id }, data });
}

export async function getPlanOrThrow(planId: string) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active) {
    throw new NotFoundError("Subscription plan not found or inactive");
  }
  return plan;
}

export async function getMySubscription(driverId: string) {
  return prisma.subscription.findFirst({
    where: { driverId, status: "active" },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
}

/**
 * Shared by both purchase paths (direct wallet debit, and the async
 * gateway path once payments/service.ts's webhook confirms the charge).
 * A new purchase always supersedes any existing active subscription —
 * starts a fresh `periodDays` window from now rather than stacking onto
 * remaining time, cancelling the old subscription's own expiry job so it
 * can't fire mid-way through the new period and wrongly revert the driver
 * to commission mode.
 */
async function grantSubscription(driverId: string, planId: string): Promise<void> {
  const plan = await getPlanOrThrow(planId);

  const existing = await prisma.subscription.findFirst({ where: { driverId, status: "active" } });
  if (existing) {
    await prisma.subscription.update({ where: { id: existing.id }, data: { status: "cancelled" } });
    await cancelSubscriptionExpiry(existing.id);
  }

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + plan.periodDays * 24 * 60 * 60 * 1000);

  const subscription = await prisma.subscription.create({
    data: { driverId, planId, startsAt, endsAt, status: "active" },
  });

  await prisma.driverProfile.update({ where: { userId: driverId }, data: { earningMode: "subscription" } });
  await scheduleSubscriptionExpiry(subscription.id, endsAt.getTime() - Date.now());
}

function purchaseLockKey(driverId: string): string {
  return `subscription:purchase-lock:${driverId}`;
}

/**
 * Debits the plan price from the driver's own wallet and grants the
 * subscription synchronously — no gateway round-trip needed, same
 * reasoning as wallet ride payments (Phase 2.3). A short Redis lock (same
 * SET NX pattern as dispatch/service.ts's driver lock) guards against a
 * double-tap double-charging the wallet while the first purchase is still
 * being processed; postEntry's negative-balance rejection handles the
 * "not enough money" case.
 */
export async function purchaseWithWallet(driverId: string, planId: string): Promise<void> {
  const locked = await redis.set(purchaseLockKey(driverId), "1", "EX", 10, "NX");
  if (locked !== "OK") {
    throw new ConflictError("A subscription purchase is already in progress");
  }

  try {
    const plan = await getPlanOrThrow(planId);

    const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
    if (!wallet) {
      throw new NotFoundError("Wallet not found");
    }

    try {
      await postEntry({
        walletId: wallet.id,
        type: "subscription_fee",
        debit: plan.price,
        credit: 0,
        meta: { planId },
        idempotencyKey: `subscription:${driverId}:${randomUUID()}`,
      });
    } catch (err) {
      if (err instanceof ConflictError) {
        throw new ConflictError("Insufficient wallet balance for this plan");
      }
      throw err;
    }

    await grantSubscription(driverId, planId);
  } finally {
    await redis.del(purchaseLockKey(driverId));
  }
}

/** Called by payments/service.ts's webhook handler once a subscription-purchase gateway charge succeeds. */
export async function activateSubscriptionFromPayment(driverId: string, planId: string): Promise<void> {
  await grantSubscription(driverId, planId);
}
