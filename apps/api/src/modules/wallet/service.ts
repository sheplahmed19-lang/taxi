// wallet module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { getConfigValue } from "../../shared/config.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { postEntry } from "./ledger.js";

const TRANSACTIONS_PAGE_SIZE = 20;

async function getWalletForUser(userId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    throw new NotFoundError("Wallet not found");
  }
  return wallet;
}

export async function getBalance(userId: string) {
  const wallet = await getWalletForUser(userId);
  return { balance: wallet.balance, currency: wallet.currency };
}

/** Cursor-paginated, newest first — pass the last entry's id back as `cursor` for the next page. */
export async function listTransactions(userId: string, cursor?: string) {
  const wallet = await getWalletForUser(userId);
  return prisma.ledgerEntry.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "desc" },
    take: TRANSACTIONS_PAGE_SIZE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}

/** VehicleType.commissionPct overrides the platform default when set. */
async function resolveCommissionPct(vehicleTypeId: string): Promise<number> {
  const vehicleType = await prisma.vehicleType.findUnique({
    where: { id: vehicleTypeId },
    select: { commissionPct: true },
  });
  if (vehicleType?.commissionPct != null) {
    return vehicleType.commissionPct;
  }
  return getConfigValue("commission_pct", 20);
}

/**
 * A driver on an active subscription (Phase 2.4) keeps 100% of every
 * fare — they've already paid for the period up front — so no commission
 * split applies at all while one is active.
 */
async function isOnActiveSubscription(driverId: string): Promise<boolean> {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  if (profile?.earningMode !== "subscription") {
    return false;
  }
  const active = await prisma.subscription.findFirst({
    where: { driverId, status: "active", endsAt: { gt: new Date() } },
  });
  return active != null;
}

/**
 * Shared by both close-out paths below: credits the driver's wallet with
 * the full fare, then (unless the driver is on an active subscription)
 * debits the platform's commission — both idempotent per trip (a replay of
 * either posts nothing new).
 */
async function postTripCommissionSplit(
  tripId: string,
  driverId: string,
  vehicleTypeId: string,
  fareTotal: number,
): Promise<{ commissionAmount: number; commissionCreated: boolean }> {
  const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
  if (!wallet) {
    throw new NotFoundError("Driver wallet not found");
  }

  await postEntry({
    walletId: wallet.id,
    tripId,
    type: "ride_earning",
    debit: 0,
    credit: fareTotal,
    idempotencyKey: `trip:${tripId}:ride_earning`,
  });

  if (await isOnActiveSubscription(driverId)) {
    return { commissionAmount: 0, commissionCreated: false };
  }

  const commissionPct = await resolveCommissionPct(vehicleTypeId);
  const commissionAmount = Math.round((fareTotal * commissionPct) / 100);
  if (commissionAmount === 0) {
    return { commissionAmount: 0, commissionCreated: false };
  }

  const commission = await postEntry({
    walletId: wallet.id,
    tripId,
    type: "commission",
    debit: commissionAmount,
    credit: 0,
    meta: { commissionPct },
    idempotencyKey: `trip:${tripId}:commission`,
  });

  return { commissionAmount, commissionCreated: commission.created };
}

/**
 * Cash trip close-out (Phase 1.8): the rider paid the driver in cash
 * directly, so the platform never held that money — only the commission
 * the driver owes is tracked. Posts the earning/commission split, then
 * increments owe_amounts by the commission (the driver already has the
 * cash in hand, so this is a real liability, unlike the electronic path
 * below), which drivers/service.ts:setAvailability already checks against
 * owe_block_threshold before letting them go online.
 */
export async function postCashTripEarnings(
  tripId: string,
  driverId: string,
  vehicleTypeId: string,
  fareTotal: number,
): Promise<void> {
  const { commissionAmount, commissionCreated } = await postTripCommissionSplit(
    tripId,
    driverId,
    vehicleTypeId,
    fareTotal,
  );

  // oweAmount.upsert's increment isn't itself idempotent, so only apply it
  // the first time this trip's commission entry is actually posted — a
  // replay (e.g. a retried close-out call) must not double-count the owed
  // amount even though the ledger entries above are correctly deduplicated.
  if (commissionCreated) {
    await prisma.oweAmount.upsert({
      where: { driverId },
      update: { amount: { increment: commissionAmount } },
      create: { driverId, amount: commissionAmount },
    });
  }
}

/**
 * Card/wallet trip close-out (Phase 2.2+): the platform actually captured
 * the fare via the payment gateway, so the commission is simply retained
 * out of money already held — nothing is owed back by the driver, unlike
 * the cash path. Posts the same earning/commission split without touching
 * owe_amounts.
 */
export async function postElectronicTripEarnings(
  tripId: string,
  driverId: string,
  vehicleTypeId: string,
  fareTotal: number,
): Promise<void> {
  await postTripCommissionSplit(tripId, driverId, vehicleTypeId, fareTotal);
}

/**
 * Wallet ride payment (Phase 2.3): atomically debits the rider's wallet for
 * the fare and credits the driver, in one step at trip completion — no
 * separate confirm/webhook round-trip like card, since the money is
 * already sitting in the platform's own ledger. Relies on postEntry's own
 * row-locked negative-balance rejection rather than a separate balance
 * pre-check, so a debit attempt racing another concurrent spend on the same
 * wallet can't produce a wrong answer (TOCTOU). Returns { paid: false }
 * on insufficient balance so the caller can fall back to cash — this is
 * not itself idempotent to retry with a different fareTotal, but replaying
 * the exact same call is safe (postEntry's idempotencyKey is per-trip).
 */
export async function settleWalletTripPayment(
  tripId: string,
  riderId: string,
  driverId: string,
  vehicleTypeId: string,
  fareTotal: number,
): Promise<{ paid: boolean }> {
  const riderWallet = await getWalletForUser(riderId);

  try {
    await postEntry({
      walletId: riderWallet.id,
      tripId,
      type: "ride_payment",
      debit: fareTotal,
      credit: 0,
      idempotencyKey: `trip:${tripId}:wallet_debit`,
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      return { paid: false };
    }
    throw err;
  }

  await postElectronicTripEarnings(tripId, driverId, vehicleTypeId, fareTotal);
  return { paid: true };
}
