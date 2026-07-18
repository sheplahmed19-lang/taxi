import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { arriveTrip, completeTrip, startTrip } from "../src/modules/trips/service.js";
import { handleWebhook, initRidePayment, initWalletTopup, __setGatewayForTesting } from "../src/modules/payments/service.js";
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
    const id = `fake_pi_${++this.counter}`;
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
      type: "payment_intent.succeeded",
      data: { object: { id: intentId, metadata } },
    }),
  );
}

function fakeFailedEvent(intentId: string, metadata: Record<string, string>) {
  return Buffer.from(
    JSON.stringify({
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

describe("payments", () => {
  beforeAll(() => {
    __setGatewayForTesting("stripe", new FakeGateway());
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
});
