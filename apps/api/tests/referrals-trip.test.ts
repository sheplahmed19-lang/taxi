import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { arriveTrip, completeTrip, startTrip } from "../src/modules/trips/service.js";
import { closeReferralBonus } from "../src/jobs/referralBonus.js";
import { generateReferralCode } from "../src/modules/referrals/service.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };
// Same values as referrals.test.ts deliberately: getConfigValue's 30s cache
// is process-wide, so if these test files land in the same vitest worker,
// whichever file's beforeAll runs last would otherwise clobber the other's
// expected amount.
const RIDER_BONUS = 300;
const DRIVER_BONUS = 500;

async function waitFor(conditionFn: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await conditionFn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition not met in time");
}

let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];

async function makeUser(phone: string, role: "rider" | "driver", withReferralCode = false) {
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: {
      phone,
      role,
      referralCode: withReferralCode ? await generateReferralCode() : undefined,
      wallet: { create: { balance: 0 } },
    },
  });
  userIds.push(user.id);
  return user;
}

async function makeOnlineDriver(phone: string, plate: string, lat: number, lng: number, withReferralCode = false) {
  const user = await makeUser(phone, "driver", withReferralCode);
  await registerDriver(user.id, { vehicleTypeId, plate });
  await approveDriver(user.id);
  await setAvailability(user.id, true);
  await recordLocation(user.id, { lat, lng });
  return user;
}

async function cleanupTrip(tripId: string): Promise<void> {
  await prisma.tripLocation.deleteMany({ where: { tripId } });
  await prisma.ledgerEntry.deleteMany({ where: { tripId } });
  await prisma.trip.delete({ where: { id: tripId } });
}

describe("referral bonus on trip completion", () => {
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

  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `ReferralTripTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeId = vt.id;
    vehicleTypeIds.push(vt.id);
  });

  afterAll(async () => {
    await closeDispatchTimeout();
    await closeReferralBonus();
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.referral.deleteMany({ where: { OR: [{ referrerId: { in: userIds } }, { refereeId: { in: userIds } }] } });
    // Referral bonus entries carry no tripId (see referrals/service.ts), so
    // cleanupTrip's per-trip ledger deletes never catch them — sweep by
    // wallet here instead, before the wallets themselves are torn down.
    await prisma.ledgerEntry.deleteMany({ where: { wallet: { userId: { in: userIds } } } });
    for (const id of userIds) {
      await prisma.oweAmount.deleteMany({ where: { driverId: id } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("credits the rider's pending referral once their first cash trip is paid", async () => {
    const referrer = await makeUser("+201000066601", "rider", true);
    const referee = await makeUser("+201000066602", "rider");
    await prisma.referral.create({
      data: { referrerId: referrer.id, refereeId: referee.id, side: "rider", bonusStatus: "pending" },
    });
    const driver = await makeOnlineDriver("+201000066611", "REF-001", 30.0505, 31.2305);

    const trip = await requestTrip(referee.id, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    await handleDriverResponse(trip.id, driver.id, true);
    await arriveTrip(trip.id, driver.id);
    await startTrip(trip.id, driver.id, trip.otp!);
    const completed = await completeTrip(trip.id, driver.id);
    expect(completed.status).toBe("paid");

    await waitFor(async () => {
      const referral = await prisma.referral.findUniqueOrThrow({ where: { refereeId: referee.id } });
      return referral.bonusStatus === "credited";
    });

    const refereeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referee.id } });
    const referrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.id } });
    expect(refereeWallet.balance).toBe(RIDER_BONUS);
    expect(referrerWallet.balance).toBe(RIDER_BONUS);

    await cleanupTrip(trip.id);
  });

  it("credits the driver's pending referral once their first cash trip is paid", async () => {
    const driverReferrer = await makeUser("+201000066603", "driver", true);
    const driver = await makeOnlineDriver("+201000066612", "REF-002", 30.0505, 31.2305);
    await prisma.referral.create({
      data: { referrerId: driverReferrer.id, refereeId: driver.id, side: "driver", bonusStatus: "pending" },
    });
    const rider = await makeUser("+201000066604", "rider");

    const trip = await requestTrip(rider.id, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    await handleDriverResponse(trip.id, driver.id, true);
    await arriveTrip(trip.id, driver.id);
    await startTrip(trip.id, driver.id, trip.otp!);
    await completeTrip(trip.id, driver.id);

    // Cash trips also net the driver their own trip earnings (ride_earning
    // minus commission) straight into their wallet — capture that baseline
    // before asserting the referral bonus is credited on top of it.
    const driverWalletBeforeBonus = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver.id } });

    await waitFor(async () => {
      const referral = await prisma.referral.findUniqueOrThrow({ where: { refereeId: driver.id } });
      return referral.bonusStatus === "credited";
    });

    const driverWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver.id } });
    const driverReferrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverReferrer.id } });
    expect(driverWallet.balance).toBe(driverWalletBeforeBonus.balance + DRIVER_BONUS);
    expect(driverReferrerWallet.balance).toBe(DRIVER_BONUS);

    await cleanupTrip(trip.id);
  });

  it("does nothing when neither trip participant has a pending referral", async () => {
    const rider = await makeUser("+201000066605", "rider");
    const driver = await makeOnlineDriver("+201000066613", "REF-003", 30.0505, 31.2305);

    const trip = await requestTrip(rider.id, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    await handleDriverResponse(trip.id, driver.id, true);
    await arriveTrip(trip.id, driver.id);
    await startTrip(trip.id, driver.id, trip.otp!);
    const completed = await completeTrip(trip.id, driver.id);
    expect(completed.status).toBe("paid");

    // Cash trips net the driver their own trip earnings regardless of
    // referrals — snapshot that right after completion, then confirm
    // nothing further moves once the (no-op) referral job has had a chance to run.
    const driverWalletAfterTrip = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver.id } });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const riderWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: rider.id } });
    const driverWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver.id } });
    expect(riderWallet.balance).toBe(0);
    expect(driverWallet.balance).toBe(driverWalletAfterTrip.balance);

    await cleanupTrip(trip.id);
  });
});
