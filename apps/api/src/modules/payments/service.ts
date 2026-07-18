// payments module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { logger } from "../../shared/logger.js";
import { ConflictError, NotFoundError, ForbiddenError, ValidationError } from "../../shared/errors.js";
import { postEntry } from "../wallet/ledger.js";
import { markTripPaid } from "../trips/service.js";
import { StripeGateway } from "./stripe.gateway.js";
import type { PaymentGateway } from "./gateway.interface.js";

const gateways: Record<string, PaymentGateway> = {
  stripe: new StripeGateway(),
};

function getGateway(name: string): PaymentGateway {
  const gateway = gateways[name];
  if (!gateway) {
    throw new NotFoundError(`Unknown payment gateway: ${name}`);
  }
  return gateway;
}

/**
 * Test-only seam: swaps out the real StripeGateway so tests can exercise
 * initWalletTopup/initRidePayment/handleWebhook without live Stripe
 * credentials (none are configured in CI or local dev by default). Not
 * used by any production code path.
 */
export function __setGatewayForTesting(name: string, gateway: PaymentGateway): void {
  gateways[name] = gateway;
}

/** Rider tops up their wallet by `amount` (minor units) via a card charge. */
export async function initWalletTopup(
  userId: string,
  amount: number,
  currency = "EGP",
): Promise<{ paymentId: string; clientSecret?: string }> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError("Top-up amount must be a positive integer (minor units)");
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    throw new NotFoundError("Wallet not found");
  }

  const payment = await prisma.payment.create({
    data: { userId, gateway: "stripe", amount, status: "pending" },
  });

  const intent = await getGateway("stripe").createIntent({
    amount,
    currency,
    metadata: { paymentId: payment.id, userId, type: "wallet_topup" },
  });

  await prisma.payment.update({ where: { id: payment.id }, data: { gatewayRef: intent.id } });

  return { paymentId: payment.id, clientSecret: intent.clientSecret };
}

/**
 * Charges the rider's card for a completed trip's final fare. Only valid
 * once the trip is "completed" (fareTotal is final at that point) and the
 * trip was booked as paymentMethod:"card" — this is deliberately a
 * separate, rider-initiated step rather than something completeTrip()
 * triggers itself, so the mobile app can present Stripe's PaymentSheet
 * with a real clientSecret before charging anything.
 */
export async function initRidePayment(
  tripId: string,
  riderId: string,
): Promise<{ paymentId: string; clientSecret?: string }> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new NotFoundError("Trip not found");
  }
  if (trip.riderId !== riderId) {
    throw new ForbiddenError("Not your trip");
  }
  if (trip.paymentMethod !== "card") {
    throw new ConflictError("Trip is not set up for card payment");
  }
  if (trip.status !== "completed") {
    throw new ConflictError("Trip must be completed before it can be charged");
  }
  if (trip.paymentStatus === "paid") {
    throw new ConflictError("Trip is already paid");
  }
  if (!trip.fareTotal) {
    throw new ConflictError("Trip has no final fare yet");
  }

  const pendingCharge = await prisma.payment.findFirst({ where: { tripId, status: "pending" } });
  if (pendingCharge) {
    throw new ConflictError("A charge for this trip is already in progress");
  }

  const payment = await prisma.payment.create({
    data: { userId: riderId, tripId, gateway: "stripe", amount: trip.fareTotal, status: "pending" },
  });

  const intent = await getGateway("stripe").createIntent({
    amount: trip.fareTotal,
    currency: "EGP",
    metadata: { paymentId: payment.id, tripId, type: "ride_payment" },
  });

  await prisma.payment.update({ where: { id: payment.id }, data: { gatewayRef: intent.id } });

  return { paymentId: payment.id, clientSecret: intent.clientSecret };
}

/**
 * Only Stripe is wired up so far — the event shape here is Stripe's. A
 * second gateway (Phase 2.3) will need this branched by `gatewayName` once
 * it exists.
 */
export async function handleWebhook(gatewayName: string, rawBody: Buffer, signature: string): Promise<void> {
  const { valid, event } = getGateway(gatewayName).verifyWebhook(rawBody, signature);
  if (!valid || !event) {
    throw new ValidationError("Invalid webhook signature");
  }

  const stripeEvent = event as Stripe.Event;
  if (stripeEvent.type !== "payment_intent.succeeded" && stripeEvent.type !== "payment_intent.payment_failed") {
    return;
  }

  const intent = stripeEvent.data.object as Stripe.PaymentIntent;
  const paymentId = intent.metadata?.paymentId;
  if (!paymentId) {
    logger.warn({ intentId: intent.id, gateway: gatewayName }, "webhook missing paymentId metadata");
    return;
  }

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    logger.warn({ paymentId, gateway: gatewayName }, "webhook references unknown payment");
    return;
  }
  // Fast-path idempotency: a webhook retry after we've already finalized
  // this payment is a no-op here. The ledger posts below are additionally
  // idempotent in their own right (postEntry's unique idempotencyKey), so
  // this isn't the only thing standing between a retry and a double-credit.
  if (payment.status !== "pending") {
    return;
  }

  if (stripeEvent.type === "payment_intent.payment_failed") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "failed", rawWebhook: stripeEvent as unknown as Prisma.InputJsonValue },
    });
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "paid", rawWebhook: stripeEvent as unknown as Prisma.InputJsonValue },
  });

  if (payment.tripId) {
    await markTripPaid(payment.tripId, payment.amount);
  } else {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: payment.userId } });
    await postEntry({
      walletId: wallet.id,
      type: "topup",
      debit: 0,
      credit: payment.amount,
      meta: { paymentId: payment.id, gateway: gatewayName },
      idempotencyKey: `payment:${payment.id}:topup`,
    });
  }
}
