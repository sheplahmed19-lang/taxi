import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { arriveTrip, completeTrip, startTrip } from "../src/modules/trips/service.js";
import { scheduleSubscriptionExpiry, closeSubscriptionExpiry } from "../src/jobs/subscriptionExpiry.js";
import {
  createPlan,
  getMySubscription,
  listActivePlans,
  purchaseWithWallet,
  updatePlan,
} from "../src/modules/subscriptions/service.js";
import { initSubscriptionPayment, handleWebhook, __setGatewayForTesting } from "../src/modules/payments/service.js";
import { ConflictError, NotFoundError } from "../src/shared/errors.js";
import type { PaymentGateway } from "../src/modules/payments/gateway.interface.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

class FakeGateway implements PaymentGateway {
  private counter = 0;
  async createIntent() {
    const id = `fake_sub_pi_${++this.counter}`;
    return { id, clientSecret: `${id}_secret` };
  }
  async capture() {
    return { status: "succeeded" as const };
  }
  verifyWebhook(payload: Buffer) {
    try {
      return { valid: true, event: JSON.parse(payload.toString("utf8")) };
    } catch {
      return { valid: false };
    }
  }
  async refund() {
    return { status: "refunded" as const };
  }
}

function fakeSucceededEvent(metadata: Record<string, string>) {
  return Buffer.from(JSON.stringify({ type: "payment_intent.succeeded", data: { object: { id: "x", metadata } } }));
}

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
const planIds: string[] = [];
const tripIds: string[] = [];
const subscriptionIds: string[] = [];

async function makeRider(phone: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, role: "rider", wallet: { create: { balance: 0 } } },
  });
  userIds.push(user.id);
  return user.id;
}

async function makeOnlineDriver(phone: string, plate: string, lat: number, lng: number): Promise<string> {
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, role: "driver", wallet: { create: { balance: 0 } } },
  });
  await registerDriver(user.id, { vehicleTypeId, plate });
  await approveDriver(user.id);
  await setAvailability(user.id, true);
  await recordLocation(user.id, { lat, lng });
  userIds.push(user.id);
  return user.id;
}

async function makeCompletedCashTrip(riderId: string, driverId: string) {
  const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
  tripIds.push(trip.id);
  await handleDriverResponse(trip.id, driverId, true);
  await arriveTrip(trip.id, driverId);
  const started = await startTrip(trip.id, driverId, (await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).otp!);
  return completeTrip(started.id, driverId);
}

describe("subscriptions (2.4)", () => {
  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `SubsTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        nightStart: "22:00",
        nightEnd: "06:00",
        active: true,
      },
    });
    vehicleTypeId = vt.id;
    vehicleTypeIds.push(vt.id);
  });

  afterAll(async () => {
    await closeDispatchTimeout();
    await closeSubscriptionExpiry();
    await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.ledgerEntry.deleteMany({
      where: { OR: [{ tripId: { in: tripIds } }, { wallet: { userId: { in: userIds } } }] },
    });
    await prisma.tripLocation.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.rating.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
    await prisma.subscription.deleteMany({ where: { id: { in: subscriptionIds } } });
    for (const id of userIds) {
      await prisma.oweAmount.deleteMany({ where: { driverId: id } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.$disconnect();
  });

  describe("commission resolution", () => {
    it("uses the vehicle type's commissionPct override instead of the global default", async () => {
      await prisma.vehicleType.update({ where: { id: vehicleTypeId }, data: { commissionPct: 35 } });
      const rider = await makeRider("+201000088801");
      const driver = await makeOnlineDriver("+201000088802", "SUB-001", 30.0505, 31.2305);

      const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
      const trip = await makeCompletedCashTrip(rider, driver);

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
      const commission = Math.round((trip.fareTotal! * 35) / 100); // override, not the seeded 20
      expect(walletAfter.balance).toBe(walletBefore.balance + trip.fareTotal! - commission);

      const owe = await prisma.oweAmount.findUniqueOrThrow({ where: { driverId: driver } });
      expect(owe.amount).toBe(commission);
    });
  });

  describe("plans", () => {
    it("admin can create and update a plan; listActivePlans only returns active ones", async () => {
      const plan = await createPlan({ name: "Weekly Pro", price: 5000, periodDays: 7 });
      planIds.push(plan.id);

      let plans = await listActivePlans();
      expect(plans.some((p) => p.id === plan.id)).toBe(true);

      await updatePlan(plan.id, { active: false });
      plans = await listActivePlans();
      expect(plans.some((p) => p.id === plan.id)).toBe(false);

      await expect(updatePlan("00000000-0000-0000-0000-000000000000", { active: true })).rejects.toThrow(NotFoundError);
    });
  });

  describe("purchaseWithWallet", () => {
    it("debits the wallet, activates the subscription, and puts the driver in subscription earning mode", async () => {
      const driver = await makeOnlineDriver("+201000088803", "SUB-002", 30.0505, 31.2305);
      await prisma.wallet.update({ where: { userId: driver }, data: { balance: 10000 } });
      const plan = await createPlan({ name: "Monthly", price: 8000, periodDays: 30 });
      planIds.push(plan.id);

      await purchaseWithWallet(driver, plan.id);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
      expect(wallet.balance).toBe(2000);

      const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId: driver } });
      expect(profile.earningMode).toBe("subscription");

      const subscription = await getMySubscription(driver);
      expect(subscription?.planId).toBe(plan.id);
      expect(subscription?.status).toBe("active");
      if (subscription) subscriptionIds.push(subscription.id);
    });

    it("rejects an insufficient balance without activating anything", async () => {
      const driver = await makeOnlineDriver("+201000088804", "SUB-003", 30.0505, 31.2305);
      const plan = await createPlan({ name: "Expensive", price: 999999, periodDays: 30 });
      planIds.push(plan.id);

      await expect(purchaseWithWallet(driver, plan.id)).rejects.toThrow(ConflictError);

      const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId: driver } });
      expect(profile.earningMode).toBe("commission");
      expect(await getMySubscription(driver)).toBeNull();
    });

    it("a second purchase supersedes the first (old cancelled, new active, no stacking)", async () => {
      const driver = await makeOnlineDriver("+201000088805", "SUB-004", 30.0505, 31.2305);
      await prisma.wallet.update({ where: { userId: driver }, data: { balance: 100000 } });
      const plan = await createPlan({ name: "Renewable", price: 1000, periodDays: 30 });
      planIds.push(plan.id);

      await purchaseWithWallet(driver, plan.id);
      const first = await getMySubscription(driver);
      expect(first).not.toBeNull();
      if (first) subscriptionIds.push(first.id);

      await purchaseWithWallet(driver, plan.id);
      const second = await getMySubscription(driver);
      expect(second).not.toBeNull();
      if (second) subscriptionIds.push(second.id);
      expect(second!.id).not.toBe(first!.id);

      const oldRow = await prisma.subscription.findUniqueOrThrow({ where: { id: first!.id } });
      expect(oldRow.status).toBe("cancelled");
    });

    it("a driver on an active subscription keeps 100% of the fare — no commission, no owe liability", async () => {
      const rider = await makeRider("+201000088806");
      const driver = await makeOnlineDriver("+201000088807", "SUB-005", 30.0505, 31.2305);
      await prisma.wallet.update({ where: { userId: driver }, data: { balance: 100000 } });
      const plan = await createPlan({ name: "Unlimited", price: 1000, periodDays: 30 });
      planIds.push(plan.id);
      await purchaseWithWallet(driver, plan.id);
      const subscription = await getMySubscription(driver);
      if (subscription) subscriptionIds.push(subscription.id);

      const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
      const trip = await makeCompletedCashTrip(rider, driver);
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });

      expect(walletAfter.balance).toBe(walletBefore.balance + trip.fareTotal!); // full fare, no cut
      expect(await prisma.oweAmount.findUnique({ where: { driverId: driver } })).toBeNull();

      const entries = await prisma.ledgerEntry.findMany({ where: { tripId: trip.id } });
      expect(entries.map((e) => e.type)).toEqual(["ride_earning"]); // no commission entry posted at all
    });
  });

  describe("gateway purchase (async, mirrors ride/topup payment)", () => {
    it("activates the subscription once the webhook confirms the charge", async () => {
      __setGatewayForTesting("stripe", new FakeGateway());
      const driver = await makeOnlineDriver("+201000088808", "SUB-006", 30.0505, 31.2305);
      const plan = await createPlan({ name: "Gateway Plan", price: 3000, periodDays: 14 });
      planIds.push(plan.id);

      const { paymentId } = await initSubscriptionPayment(driver, plan.id);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment.tripId).toBeNull();

      await handleWebhook(
        "stripe",
        fakeSucceededEvent({ paymentId, driverId: driver, planId: plan.id, type: "subscription_purchase" }),
        "sig",
      );

      const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId: driver } });
      expect(profile.earningMode).toBe("subscription");
      const subscription = await getMySubscription(driver);
      expect(subscription?.planId).toBe(plan.id);
      if (subscription) subscriptionIds.push(subscription.id);

      // Gateway path never touches the driver's own wallet balance.
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
      expect(wallet.balance).toBe(0);
    });
  });

  describe("expiry job", () => {
    it("reverts the driver to commission mode and notifies them once the subscription expires", async () => {
      const driver = await makeOnlineDriver("+201000088809", "SUB-007", 30.0505, 31.2305);
      const plan = await createPlan({ name: "ShortLived", price: 100, periodDays: 1 });
      planIds.push(plan.id);

      const subscription = await prisma.subscription.create({
        data: {
          driverId: driver,
          planId: plan.id,
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 1000),
          status: "active",
        },
      });
      subscriptionIds.push(subscription.id);
      await prisma.driverProfile.update({ where: { userId: driver }, data: { earningMode: "subscription" } });

      await scheduleSubscriptionExpiry(subscription.id, 100);

      await waitFor(async () => {
        const row = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
        return row.status === "expired";
      });

      const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId: driver } });
      expect(profile.earningMode).toBe("commission");

      const notification = await prisma.notification.findFirst({ where: { userId: driver, title: "Subscription expired" } });
      expect(notification).not.toBeNull();
    });
  });
});
