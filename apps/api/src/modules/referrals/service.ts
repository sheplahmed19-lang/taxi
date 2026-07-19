// referrals module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { randomInt } from "node:crypto";
import { prisma } from "../../db/index.js";
import { getConfigValue } from "../../shared/config.js";
import { postEntry } from "../wallet/ledger.js";
import { sendToUser } from "../notifications/service.js";

// Excludes 0/O/1/I — easier to read aloud and type back in from a share sheet.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  }
  return code;
}

/** Generates a globally-unique referral code. Called once, at account creation (auth/service.ts). */
export async function generateReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const existing = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (!existing) {
      return code;
    }
  }
  throw new Error("Could not generate a unique referral code after 5 attempts");
}

/**
 * Links a brand-new user to whoever referred them, if `code` resolves to a
 * real (and different) user. Only meaningful on the new-account path of
 * auth/service.ts:findOrCreateUserByPhone — an existing user re-verifying
 * OTP already has whatever referral history it has. Invalid/self codes are
 * silently ignored rather than failing signup: referral attribution is a
 * nice-to-have, never a login gate. Returns whether it actually linked.
 */
export async function attachReferral(
  refereeId: string,
  refereeRole: "rider" | "driver",
  code: string,
): Promise<boolean> {
  const referrer = await prisma.user.findUnique({ where: { referralCode: code.toUpperCase() } });
  if (!referrer || referrer.id === refereeId) {
    return false;
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: refereeId }, data: { referredBy: referrer.id } }),
    prisma.referral.create({
      data: { referrerId: referrer.id, refereeId, side: refereeRole, bonusStatus: "pending" },
    }),
  ]);
  return true;
}

async function getBonusAmount(side: "rider" | "driver"): Promise<number> {
  const key = side === "rider" ? "referral_bonus_rider" : "referral_bonus_driver";
  return getConfigValue(key, 0);
}

/**
 * Credits both referrer and referee, once, the first time this specific
 * user (rider or driver — whichever `userId` is) settles a trip while their
 * referral is still "pending". Called from jobs/referralBonus.ts's worker,
 * itself enqueued by trips/service.ts the moment a trip reaches "paid" —
 * this is the plan's "credit both after referee's first completed trip".
 * `tripId` is carried through only as ledger entry metadata (the bonus
 * isn't fare-derived, so LedgerEntry.tripId — FK-constrained when set — is
 * deliberately left unset).
 *
 * Both wallets are credited *before* the referral flips to "credited", so a
 * crash mid-function can never leave a referral marked paid without the
 * money having actually moved. That ordering also makes concurrent/retried
 * calls for the same referral safe without an explicit claim step: postEntry
 * is idempotency-keyed per referral, so a duplicate call just replays the
 * existing entry instead of double-crediting.
 */
export async function creditReferralBonusIfPending(userId: string, tripId: string): Promise<void> {
  const referral = await prisma.referral.findUnique({ where: { refereeId: userId } });
  if (!referral || referral.bonusStatus !== "pending") {
    return;
  }

  const amount = await getBonusAmount(referral.side);
  if (amount <= 0) {
    return;
  }

  const [refereeWallet, referrerWallet] = await Promise.all([
    prisma.wallet.findUniqueOrThrow({ where: { userId: referral.refereeId } }),
    prisma.wallet.findUniqueOrThrow({ where: { userId: referral.referrerId } }),
  ]);

  await postEntry({
    walletId: refereeWallet.id,
    type: "referral_bonus",
    debit: 0,
    credit: amount,
    meta: { referralId: referral.id, triggeringTripId: tripId },
    idempotencyKey: `referral:${referral.id}:referee`,
  });
  await postEntry({
    walletId: referrerWallet.id,
    type: "referral_bonus",
    debit: 0,
    credit: amount,
    meta: { referralId: referral.id, triggeringTripId: tripId },
    idempotencyKey: `referral:${referral.id}:referrer`,
  });

  await prisma.referral.updateMany({
    where: { id: referral.id, bonusStatus: "pending" },
    data: { bonusStatus: "credited" },
  });

  await Promise.all([
    sendToUser(referral.refereeId, {
      title: "Referral bonus credited",
      body: "Thanks for joining via a referral — your bonus is in your wallet.",
      data: { type: "referral_bonus", referralId: referral.id },
    }),
    sendToUser(referral.referrerId, {
      title: "Referral bonus credited",
      body: "Your referral completed their first trip — your bonus is in your wallet.",
      data: { type: "referral_bonus", referralId: referral.id },
    }),
  ]);
}

export interface ReferralStats {
  code: string | null;
  totalReferred: number;
  pending: number;
  credited: number;
}

export async function getMyCode(userId: string): Promise<{ code: string | null }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
  return { code: user.referralCode };
}

export async function getMyStats(userId: string): Promise<ReferralStats> {
  const [user, referrals] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } }),
    prisma.referral.findMany({ where: { referrerId: userId }, select: { bonusStatus: true } }),
  ]);

  return {
    code: user.referralCode,
    totalReferred: referrals.length,
    pending: referrals.filter((r) => r.bonusStatus === "pending").length,
    credited: referrals.filter((r) => r.bonusStatus === "credited").length,
  };
}
