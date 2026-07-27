import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { arriveTrip, completeTrip, startTrip } from "../src/modules/trips/service.js";
import { handleWebhook, initRidePayment, initWalletTopup, __setGatewayForTesting } from "../src/modules/payments/service.js";
import { settleWalletTripPayment } from "../src/modules/wallet/service.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/shared/errors.js";
import type { PaymentGateway } from "../src/modules/payments/gateway.interface.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

/**
 * Stands in for Stripe: no live credentials are configured in this
 * environment (or in CI), so this fake implements the same interface and
 * lets tests drive createIntent -> webhook exactly like the real adapter
 * would, without a network call. See payments/service.ts:__setGatewayForTesting.
 */
class FakeGateway implements PaymentGateway {
  private counter = 0;

  async createIntent(input: { amount: number; currency: string; metadata?: Record<string, unknown> }) {
    // Date.now() alongside the counter, not just the counter alone: a fresh
    // `pnpm test` process resets the counter to 0 and replays the exact same
    // id sequence, which collided with service.ts's webhook-replay dedupe
    // Redis keys (Phase 5.2, 24h TTL) left over from the previous run.
    const id = `fake_pi_${Date.now()}_${++this.counter}`;
    return { id, clientSecret: `${id}_secret` };
  }

  async capture(intentId: string) {
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

function fakeSucceededEvent(intentId: string, metadata: Record<string, string>) {
  return Buffer.from(
    JSON.stringify({
      // A real Stripe event always carries a unique top-level id
      // (evt_...) — service.ts's webhook-replay dedupe (Phase 5.2) keys on
      // it, so fixtures need one too, distinct from the nested payment
      // intent id, or every fake event in the suite would collide as the
      // same "duplicate" delivery.
      id: `evt_${intentId}`,
      type: "payment_intent.succeeded",
      data: { object: { id: intentId, metadata } },
    }),
  );
}

function fakeFailedEvent(intentId: string, metadata: Record<string, string>) {
  return Buffer.from(
    JSON.stringify({
      id: `evt_${intentId}_failed`,
      type: "payment_intent.payment_failed",
      data: { object: { id: intentId, metadata } },
    }),
  );
}

let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];
const tripIds: string[] = [];

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

async function makeCompletedCardTrip(riderId: string, driverId: string) {
  const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "card" });
  tripIds.push(trip.id);
  await handleDriverResponse(trip.id, driverId, true);
  await arriveTrip(trip.id, driverId);
  const started = await startTrip(trip.id, driverId, (await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).otp!);
  return completeTrip(started.id, driverId);
}

async function makeCompletedTrip(riderId: string, driverId: string, paymentMethod: "wallet" | "cash") {
  const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod });
  tripIds.push(trip.id);
  await handleDriverResponse(trip.id, driverId, true);
  await arriveTrip(trip.id, driverId);
  const started = await startTrip(trip.id, driverId, (await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).otp!);
  return completeTrip(started.id, driverId);
}

function fakePaystackSucceededEvent(metadata: Record<string, string>) {
  // Real Paystack webhooks carry no top-level event id; service.ts's replay
  // dedupe falls back to data.id/data.reference + event type, so — same
  // reasoning as the Stripe fixtures above — the reference must be unique
  // per payment, not a shared literal every fixture in the suite reused.
  return Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: `ps_${metadata.paymentId}`, metadata } }));
}

function fakePaystackFailedEvent(metadata: Record<string, string>) {
  return Buffer.from(JSON.stringify({ event: "charge.failed", data: { reference: `ps_${metadata.paymentId}_failed`, metadata } }));
}

describe("payments", () => {
  beforeAll(() => {
    __setGatewayForTesting("stripe", new FakeGateway());
    __setGatewayForTesting("paystack", new FakeGateway());
  });

  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `PaymentsTest-${Date.now()}-${Math.random()}`,
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
    await prisma.payment.deleteMany({ where: { OR: [{ tripId: { in: tripIds } }, { userId: { in: userIds } }] } });
    await prisma.ledgerEntry.deleteMany({
      where: { OR: [{ tripId: { in: tripIds } }, { wallet: { userId: { in: userIds } } }] },
    });
    await prisma.tripLocation.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.rating.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
    for (const id of userIds) {
      await prisma.oweAmount.deleteMany({ where: { driverId: id } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  describe("initWalletTopup", () => {
    it("rejects non-positive or non-integer amounts", async () => {
      const rider = await makeRider("+201000099101");
      await expect(initWalletTopup(rider, 0)).rejects.toThrow(ValidationError);
      await expect(initWalletTopup(rider, -100)).rejects.toThrow(ValidationError);
      await expect(initWalletTopup(rider, 10.5)).rejects.toThrow(ValidationError);
    });

    it("creates a pending Payment and returns a client secret", async () => {
      const rider = await makeRider("+201000099102");
      const result = await initWalletTopup(rider, 1000);
      expect(result.clientSecret).toBeTruthy();

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
      expect(payment.status).toBe("pending");
      expect(payment.amount).toBe(1000);
      expect(payment.tripId).toBeNull();
      expect(payment.gatewayRef).toBeTruthy();
    });

    it("credits the wallet once the webhook confirms success, and is idempotent under a retried webhook", async () => {
      const rider = await makeRider("+201000099103");
      const before = await prisma.wallet.findUniqueOrThrow({ where: { userId: rider } });

      const { paymentId } = await initWalletTopup(rider, 750);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

      const event = fakeSucceededEvent(payment.gatewayRef!, { paymentId, userId: rider, type: "wallet_topup" });
      await handleWebhook("stripe", event, "any-sig");
      await handleWebhook("stripe", event, "any-sig"); // simulate Stripe's at-least-once delivery

      const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: rider } });
      expect(after.balance).toBe(before.balance + 750); // not 1500

      const settled = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(settled.status).toBe("paid");
    });

    it("marks the payment failed on a payment_intent.payment_failed webhook, without touching the wallet", async () => {
      const rider = await makeRider("+201000099104");
      const before = await prisma.wallet.findUniqueOrThrow({ where: { userId: rider } });

      const { paymentId } = await initWalletTopup(rider, 400);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

      await handleWebhook("stripe", fakeFailedEvent(payment.gatewayRef!, { paymentId }), "any-sig");

      const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: rider } });
      expect(after.balance).toBe(before.balance);

      const settled = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(settled.status).toBe("failed");
    });
  });

  describe("initRidePayment", () => {
    it("rejects a non-participant rider", async () => {
      const rider = await makeRider("+201000099201");
      const stranger = await makeRider("+201000099202");
      const driver = await makeOnlineDriver("+201000099203", "PAY-001", 30.0505, 31.2305);
      const trip = await makeCompletedCardTrip(rider, driver);

      await expect(initRidePayment(trip.id, stranger)).rejects.toThrow(ForbiddenError);
    });

    it("rejects a trip that isn't paymentMethod:card", async () => {
      const rider = await makeRider("+201000099204");
      const driver = await makeOnlineDriver("+201000099205", "PAY-002", 30.0505, 31.2305);
      const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
      tripIds.push(trip.id);
      await handleDriverResponse(trip.id, driver, true);

      await expect(initRidePayment(trip.id, rider)).rejects.toThrow(ConflictError);
    });

    it("rejects a trip that isn't completed yet", async () => {
      const rider = await makeRider("+201000099206");
      const driver = await makeOnlineDriver("+201000099207", "PAY-003", 30.0505, 31.2305);
      const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "card" });
      tripIds.push(trip.id);
      await handleDriverResponse(trip.id, driver, true);

      await expect(initRidePayment(trip.id, rider)).rejects.toThrow(ConflictError);
    });

    it("creates a payment for the trip's final fare once completed", async () => {
      const rider = await makeRider("+201000099208");
      const driver = await makeOnlineDriver("+201000099209", "PAY-004", 30.0505, 31.2305);
      const trip = await makeCompletedCardTrip(rider, driver);
      expect(trip.status).toBe("completed"); // card trips do NOT auto-settle like cash does

      const result = await initRidePayment(trip.id, rider);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
      expect(payment.tripId).toBe(trip.id);
      expect(payment.amount).toBe(trip.fareTotal);

      await expect(initRidePayment(trip.id, rider)).rejects.toThrow(ConflictError); // already has a pending charge... but not yet "paid"
    });

    it("full flow: webhook success settles the trip to paid and credits the driver without an owe_amounts liability", async () => {
      const rider = await makeRider("+201000099210");
      const driver = await makeOnlineDriver("+201000099211", "PAY-005", 30.0505, 31.2305);
      const trip = await makeCompletedCardTrip(rider, driver);

      const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });

      const { paymentId } = await initRidePayment(trip.id, rider);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      await handleWebhook("stripe", fakeSucceededEvent(payment.gatewayRef!, { paymentId, tripId: trip.id, type: "ride_payment" }), "sig");

      const settledTrip = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
      expect(settledTrip.status).toBe("paid");
      expect(settledTrip.paymentStatus).toBe("paid");

      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
      const commission = Math.round((trip.fareTotal! * 20) / 100);
      expect(walletAfter.balance).toBe(walletBefore.balance + trip.fareTotal! - commission);

      // Unlike cash, the platform already captured the money — no commission liability remains.
      const owe = await prisma.oweAmount.findUnique({ where: { driverId: driver } });
      expect(owe).toBeNull();
    });

    it("a retried webhook after settlement does not double-credit the driver", async () => {
      const rider = await makeRider("+201000099212");
      const driver = await makeOnlineDriver("+201000099213", "PAY-006", 30.0505, 31.2305);
      const trip = await makeCompletedCardTrip(rider, driver);

      const { paymentId } = await initRidePayment(trip.id, rider);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const event = fakeSucceededEvent(payment.gatewayRef!, { paymentId, tripId: trip.id, type: "ride_payment" });

      await handleWebhook("stripe", event, "sig");
      const walletAfterFirst = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });

      await handleWebhook("stripe", event, "sig");
      const walletAfterSecond = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });

      expect(walletAfterSecond.balance).toBe(walletAfterFirst.balance);
    });
  });

  describe("wallet ride payment (2.3)", () => {
    it("settleWalletTripPayment returns paid:false and posts nothing when the balance is insufficient", async () => {
      const rider = await makeRider("+201000099301");
      const driver = await makeOnlineDriver("+201000099302", "PAY-101", 30.0505, 31.2305);

      const result = await settleWalletTripPayment("fake-trip-insufficient", rider, driver, vehicleTypeId, 999999);
      expect(result.paid).toBe(false);

      const entries = await prisma.ledgerEntry.findMany({ where: { tripId: "fake-trip-insufficient" } });
      expect(entries).toHaveLength(0);
    });

    it("atomically debits the rider and credits the driver when the balance is sufficient", async () => {
      const rider = await makeRider("+201000099303");
      const driver = await makeOnlineDriver("+201000099304", "PAY-102", 30.0505, 31.2305);
      await prisma.wallet.update({ where: { userId: rider }, data: { balance: 5000 } });

      const trip = await makeCompletedTrip(rider, driver, "wallet");
      expect(trip.status).toBe("paid"); // unlike card, wallet settles synchronously at completion
      expect(trip.paymentMethod).toBe("wallet");

      const riderWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: rider } });
      expect(riderWallet.balance).toBe(5000 - trip.fareTotal!);

      const driverWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
      const commission = Math.round((trip.fareTotal! * 20) / 100);
      expect(driverWallet.balance).toBe(trip.fareTotal! - commission);

      const owe = await prisma.oweAmount.findUnique({ where: { driverId: driver } });
      expect(owe).toBeNull(); // platform already held the money — no liability like cash
    });

    it("falls back to cash and notifies the rider when the wallet balance is insufficient", async () => {
      const rider = await makeRider("+201000099305");
      const driver = await makeOnlineDriver("+201000099306", "PAY-103", 30.0505, 31.2305);
      // Wallet starts at 0 — nowhere near the fare.

      const trip = await makeCompletedTrip(rider, driver, "wallet");
      expect(trip.status).toBe("paid");
      expect(trip.paymentMethod).toBe("cash"); // rewritten by the fallback

      const riderWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: rider } });
      expect(riderWallet.balance).toBe(0); // untouched — no debit was ever posted

      const owe = await prisma.oweAmount.findUniqueOrThrow({ where: { driverId: driver } });
      const commission = Math.round((trip.fareTotal! * 20) / 100);
      expect(owe.amount).toBe(commission); // cash-style commission liability, same as a real cash trip

      const notification = await prisma.notification.findFirst({ where: { userId: rider, title: "Wallet balance too low" } });
      expect(notification).not.toBeNull();
    });
  });

  describe("second gateway: Paystack (2.3)", () => {
    it("requires the rider to have an email on file before routing through Paystack", async () => {
      const rider = await makeRider("+201000099401");
      await expect(initWalletTopup(rider, 1000, "EGP", "paystack")).rejects.toThrow(ValidationError);
    });

    it("creates a Payment tagged with the paystack gateway once the rider has an email", async () => {
      const rider = await makeRider("+201000099402");
      await prisma.user.update({ where: { id: rider }, data: { email: "rider402@example.com" } });

      const result = await initWalletTopup(rider, 1200, "EGP", "paystack");
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
      expect(payment.gateway).toBe("paystack");
      expect(payment.amount).toBe(1200);
    });

    it("credits the wallet from a Paystack-shaped (charge.success) webhook", async () => {
      const rider = await makeRider("+201000099403");
      await prisma.user.update({ where: { id: rider }, data: { email: "rider403@example.com" } });
      const before = await prisma.wallet.findUniqueOrThrow({ where: { userId: rider } });

      const { paymentId } = await initWalletTopup(rider, 600, "EGP", "paystack");
      await handleWebhook("paystack", fakePaystackSucceededEvent({ paymentId, userId: rider, type: "wallet_topup" }), "sig");

      const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: rider } });
      expect(after.balance).toBe(before.balance + 600);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment.status).toBe("paid");
    });

    it("marks the payment failed on a charge.failed webhook, without touching the wallet", async () => {
      const rider = await makeRider("+201000099404");
      await prisma.user.update({ where: { id: rider }, data: { email: "rider404@example.com" } });
      const before = await prisma.wallet.findUniqueOrThrow({ where: { userId: rider } });

      const { paymentId } = await initWalletTopup(rider, 300, "EGP", "paystack");
      await handleWebhook("paystack", fakePaystackFailedEvent({ paymentId }), "sig");

      const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: rider } });
      expect(after.balance).toBe(before.balance);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment.status).toBe("failed");
    });
  });
});
