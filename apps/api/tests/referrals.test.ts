import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { findOrCreateUserByPhone } from "../src/modules/auth/service.js";
import {
  attachReferral,
  creditReferralBonusIfPending,
  generateReferralCode,
  getMyCode,
  getMyStats,
} from "../src/modules/referrals/service.js";

const RIDER_BONUS = 300;
const DRIVER_BONUS = 500;

const userIds: string[] = [];

async function makeUser(phone: string, role: "rider" | "driver" = "rider") {
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, role, referralCode: await generateReferralCode(), wallet: { create: { balance: 0 } } },
  });
  userIds.push(user.id);
  return user;
}

describe("referrals", () => {
  beforeAll(async () => {
    await prisma.systemConfig.upsert({
      where: { key: "referral_bonus_rider" },
      update: { value: RIDER_BONUS },
      create: { key: "referral_bonus_rider", value: RIDER_BONUS },
    });
    await prisma.systemConfig.upsert({
      where: { key: "referral_bonus_driver" },
      update: { value: DRIVER_BONUS },
      create: { key: "referral_bonus_driver", value: DRIVER_BONUS },
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { wallet: { userId: { in: userIds } } } });
    await prisma.referral.deleteMany({ where: { OR: [{ referrerId: { in: userIds } }, { refereeId: { in: userIds } }] } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("generateReferralCode produces distinct 8-character codes", async () => {
    const a = await generateReferralCode();
    const b = await generateReferralCode();
    expect(a).toHaveLength(8);
    expect(b).toHaveLength(8);
    expect(a).not.toBe(b);
  });

  it("findOrCreateUserByPhone assigns every new user their own referral code", async () => {
    const user = await findOrCreateUserByPhone("+201000077701", "rider");
    userIds.push(user.id);
    expect(user.referralCode).toHaveLength(8);
  });

  it("findOrCreateUserByPhone attaches a valid referral code on the new-account path", async () => {
    const referrer = await makeUser("+201000077702", "rider");

    const referee = await findOrCreateUserByPhone("+201000077703", "rider", referrer.referralCode!);
    userIds.push(referee.id);

    expect(referee.referredBy).toBe(referrer.id);
    const referral = await prisma.referral.findUnique({ where: { refereeId: referee.id } });
    expect(referral?.referrerId).toBe(referrer.id);
    expect(referral?.side).toBe("rider");
    expect(referral?.bonusStatus).toBe("pending");
  });

  it("findOrCreateUserByPhone silently ignores a referral code on an existing (returning) login", async () => {
    const referrer = await makeUser("+201000077704", "rider");
    const returning = await makeUser("+201000077705", "rider");

    const again = await findOrCreateUserByPhone(returning.phone, "rider", referrer.referralCode!);
    expect(again.id).toBe(returning.id);
    expect(again.referredBy).toBeNull();
    const referral = await prisma.referral.findUnique({ where: { refereeId: returning.id } });
    expect(referral).toBeNull();
  });

  it("attachReferral silently no-ops on an unknown code", async () => {
    const referee = await makeUser("+201000077706", "rider");
    const linked = await attachReferral(referee.id, "rider", "NOT-A-REAL-CODE");
    expect(linked).toBe(false);
  });

  it("attachReferral silently no-ops on a self-referral", async () => {
    const user = await makeUser("+201000077707", "rider");
    const linked = await attachReferral(user.id, "rider", user.referralCode!);
    expect(linked).toBe(false);
  });

  it("creditReferralBonusIfPending credits both parties once and marks the referral credited", async () => {
    const referrer = await makeUser("+201000077708", "rider");
    const referee = await makeUser("+201000077709", "rider");
    await prisma.referral.create({
      data: { referrerId: referrer.id, refereeId: referee.id, side: "rider", bonusStatus: "pending" },
    });

    await creditReferralBonusIfPending(referee.id, "00000000-0000-0000-0000-000000000000");

    const referral = await prisma.referral.findUniqueOrThrow({ where: { refereeId: referee.id } });
    expect(referral.bonusStatus).toBe("credited");

    const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referee.id } });
    const referrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.id } });
    expect(refereeWallet.balance).toBe(RIDER_BONUS);
    expect(referrerWallet.balance).toBe(RIDER_BONUS);

    const notifications = await prisma.notification.findMany({ where: { userId: { in: [referee.id, referrer.id] } } });
    expect(notifications).toHaveLength(2);
  });

  it("creditReferralBonusIfPending uses the driver bonus amount when the referee is a driver", async () => {
    const referrer = await makeUser("+201000077710", "driver");
    const referee = await makeUser("+201000077711", "driver");
    await prisma.referral.create({
      data: { referrerId: referrer.id, refereeId: referee.id, side: "driver", bonusStatus: "pending" },
    });

    await creditReferralBonusIfPending(referee.id, "00000000-0000-0000-0000-000000000000");

    const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referee.id } });
    expect(refereeWallet.balance).toBe(DRIVER_BONUS);
  });

  it("creditReferralBonusIfPending is idempotent — a second call never double-credits", async () => {
    const referrer = await makeUser("+201000077712", "rider");
    const referee = await makeUser("+201000077713", "rider");
    await prisma.referral.create({
      data: { referrerId: referrer.id, refereeId: referee.id, side: "rider", bonusStatus: "pending" },
    });

    await creditReferralBonusIfPending(referee.id, "00000000-0000-0000-0000-000000000000");
    await creditReferralBonusIfPending(referee.id, "00000000-0000-0000-0000-000000000000");
    await creditReferralBonusIfPending(referee.id, "11111111-1111-1111-1111-111111111111");

    const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referee.id } });
    expect(refereeWallet.balance).toBe(RIDER_BONUS);
  });

  it("creditReferralBonusIfPending no-ops for a user with no referral at all", async () => {
    const lone = await makeUser("+201000077714", "rider");
    await expect(creditReferralBonusIfPending(lone.id, "00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: lone.id } });
    expect(wallet.balance).toBe(0);
  });

  it("getMyCode / getMyStats reflect referral activity", async () => {
    const referrer = await makeUser("+201000077715", "rider");
    const pendingReferee = await makeUser("+201000077716", "rider");
    const creditedReferee = await makeUser("+201000077717", "rider");
    await prisma.referral.create({
      data: { referrerId: referrer.id, refereeId: pendingReferee.id, side: "rider", bonusStatus: "pending" },
    });
    await prisma.referral.create({
      data: { referrerId: referrer.id, refereeId: creditedReferee.id, side: "rider", bonusStatus: "credited" },
    });

    const code = await getMyCode(referrer.id);
    expect(code.code).toBe(referrer.referralCode);

    const stats = await getMyStats(referrer.id);
    expect(stats.totalReferred).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.credited).toBe(1);
  });
});
