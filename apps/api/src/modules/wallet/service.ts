// wallet module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { getConfigValue } from "../../shared/config.js";
import { NotFoundError } from "../../shared/errors.js";
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

/**
 * Cash trip close-out (Phase 1.8): the rider paid the driver in cash
 * directly, so the platform never held that money — only the commission
 * the driver owes is tracked. Posts an earning credit + commission debit
 * on the driver's wallet (both idempotent per trip) and increments
 * owe_amounts by the commission, which drivers/service.ts:setAvailability
 * already checks against owe_block_threshold before letting them go online.
 */
export async function postCashTripEarnings(tripId: string, driverId: string, fareTotal: number): Promise<void> {
  const wallet = await prisma.wallet.findUnique({ where: { userId: driverId } });
  if (!wallet) {
    throw new NotFoundError("Driver wallet not found");
  }

  const commissionPct = await getConfigValue("commission_pct", 20);
  const commissionAmount = Math.round((fareTotal * commissionPct) / 100);

  await postEntry({
    walletId: wallet.id,
    tripId,
    type: "ride_earning",
    debit: 0,
    credit: fareTotal,
    meta: { commissionPct },
    idempotencyKey: `trip:${tripId}:ride_earning`,
  });

  const commission = await postEntry({
    walletId: wallet.id,
    tripId,
    type: "commission",
    debit: commissionAmount,
    credit: 0,
    meta: { commissionPct },
    idempotencyKey: `trip:${tripId}:commission`,
  });

  // oweAmount.upsert's increment isn't itself idempotent, so only apply it
  // the first time this trip's commission entry is actually posted — a
  // replay (e.g. a retried close-out call) must not double-count the owed
  // amount even though the ledger entries above are correctly deduplicated.
  if (commission.created) {
    await prisma.oweAmount.upsert({
      where: { driverId },
      update: { amount: { increment: commissionAmount } },
      create: { driverId, amount: commissionAmount },
    });
  }
}
