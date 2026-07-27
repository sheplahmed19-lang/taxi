// payments module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { redis } from "../../shared/redis.js";
import { logger } from "../../shared/logger.js";
import { ConflictError, NotFoundError, ForbiddenError, ValidationError } from "../../shared/errors.js";
import { postEntry } from "../wallet/ledger.js";
import { markTripPaid } from "../trips/service.js";
import { activateSubscriptionFromPayment, getPlanOrThrow } from "../subscriptions/service.js";
import { StripeGateway } from "./stripe.gateway.js";
import { PaystackGateway } from "./paystack.gateway.js";
import type { PaymentGateway } from "./gateway.interface.js";

export const DEFAULT_GATEWAY = "stripe";
const WEBHOOK_DEDUPE_TTL_S = 24 * 60 * 60;

const gateways: Record<string, PaymentGateway> = {
  stripe: new StripeGateway(),
  paystack: new PaystackGateway(),
};

function getGateway(name: string): PaymentGateway {
  const gateway = gateways[name];
  if (!gateway) {
    throw new NotFoundError(`Unknown payment gateway: ${name}`);
  }
  return gateway;
}

/**
 * Test-only seam: swaps out a real gateway so tests can exercise
 * initWalletTopup/initRidePayment/handleWebhook without live credentials
 * (none are configured in CI or local dev by default). Not used by any
 * production code path.
 */
export function __setGatewayForTesting(name: string, gateway: PaymentGateway): void {
  gateways[name] = gateway;
}

/**
 * Paystack's initialize-transaction call requires an email; Stripe doesn't
 * need one. Rather than widen createIntent()'s generic signature for one
 * gateway, this is folded into the metadata bag only when routing through
 * a gateway that needs it.
 */
async function emailMetadataFor(gatewayName: string, userId: string): Promise<Record<string, unknown>> {
  if (gatewayName !== "paystack") {
    return {};
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.email) {
    throw new ValidationError("Add an email to your profile before paying with this method");
  }
  return { email: user.email };
}

/** Rider tops up their wallet by `amount` (minor units) via a card charge. */
export async function initWalletTopup(
  userId: string,
  amount: number,
  currency = "EGP",
  gatewayName: string = DEFAULT_GATEWAY,
): Promise<{ paymentId: string; clientSecret?: string; redirectUrl?: string }> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError("Top-up amount must be a positive integer (minor units)");
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    throw new NotFoundError("Wallet not found");
  }

  const payment = await prisma.payment.create({
    data: { userId, gateway: gatewayName, amount, status: "pending" },
  });

  const intent = await getGateway(gatewayName).createIntent({
    amount,
    currency,
    metadata: {
      paymentId: payment.id,
      userId,
      type: "wallet_topup",
      ...(await emailMetadataFor(gatewayName, userId)),
    },
  });

  await prisma.payment.update({ where: { id: payment.id }, data: { gatewayRef: intent.id } });

  return { paymentId: payment.id, clientSecret: intent.clientSecret, redirectUrl: intent.redirectUrl };
}

/**
 * Charges the rider's card for a completed trip's final fare. Only valid
 * once the trip is "completed" (fareTotal is final at that point) and the
 * trip was booked as paymentMethod:"card" — this is deliberately a
 * separate, rider-initiated step rather than something completeTrip()
 * triggers itself, so the mobile app can present the gateway's own
 * confirm step (Stripe PaymentSheet's clientSecret, or Paystack's hosted
 * checkout redirectUrl) with a real value before charging anything.
 */
export async function initRidePayment(
  tripId: string,
  riderId: string,
  gatewayName: string = DEFAULT_GATEWAY,
): Promise<{ paymentId: string; clientSecret?: string; redirectUrl?: string }> {
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
    data: { userId: riderId, tripId, gateway: gatewayName, amount: trip.fareTotal, status: "pending" },
  });

  const intent = await getGateway(gatewayName).createIntent({
    amount: trip.fareTotal,
    currency: "EGP",
    metadata: {
      paymentId: payment.id,
      tripId,
      type: "ride_payment",
      ...(await emailMetadataFor(gatewayName, riderId)),
    },
  });

  await prisma.payment.update({ where: { id: payment.id }, data: { gatewayRef: intent.id } });

  return { paymentId: payment.id, clientSecret: intent.clientSecret, redirectUrl: intent.redirectUrl };
}

/**
 * Async counterpart to subscriptions/service.ts:purchaseWithWallet — same
 * plan, paid via a gateway charge instead of a wallet debit. The
 * subscription is only granted once handleWebhook below sees the charge
 * actually succeed, same as initRidePayment/markTripPaid.
 */
export async function initSubscriptionPayment(
  driverId: string,
  planId: string,
  gatewayName: string = DEFAULT_GATEWAY,
): Promise<{ paymentId: string; clientSecret?: string; redirectUrl?: string }> {
  const plan = await getPlanOrThrow(planId);

  const payment = await prisma.payment.create({
    data: { userId: driverId, gateway: gatewayName, amount: plan.price, status: "pending" },
  });

  const intent = await getGateway(gatewayName).createIntent({
    amount: plan.price,
    currency: "EGP",
    metadata: {
      paymentId: payment.id,
      driverId,
      planId,
      type: "subscription_purchase",
      ...(await emailMetadataFor(gatewayName, driverId)),
    },
  });

  await prisma.payment.update({ where: { id: payment.id }, data: { gatewayRef: intent.id } });

  return { paymentId: payment.id, clientSecret: intent.clientSecret, redirectUrl: intent.redirectUrl };
}

interface NormalizedWebhookEvent {
  eventId: string;
  succeeded: boolean;
  failed: boolean;
  metadata: Record<string, string>;
}

function normalizeStripeEvent(event: unknown): NormalizedWebhookEvent | null {
  const stripeEvent = event as Stripe.Event;
  if (stripeEvent.type !== "payment_intent.succeeded" && stripeEvent.type !== "payment_intent.payment_failed") {
    return null;
  }
  const intent = stripeEvent.data.object as Stripe.PaymentIntent;
  return {
    eventId: stripeEvent.id,
    succeeded: stripeEvent.type === "payment_intent.succeeded",
    failed: stripeEvent.type === "payment_intent.payment_failed",
    metadata: (intent.metadata ?? {}) as Record<string, string>,
  };
}

interface PaystackWebhookShape {
  event: string;
  data?: { id?: number | string; reference?: string; metadata?: Record<string, unknown> | null };
}

function normalizePaystackEvent(event: unknown): NormalizedWebhookEvent | null {
  const paystackEvent = event as PaystackWebhookShape;
  if (paystackEvent.event !== "charge.success" && paystackEvent.event !== "charge.failed") {
    return null;
  }
  const rawMetadata = paystackEvent.data?.metadata;
  const metadata: Record<string, string> =
    rawMetadata && typeof rawMetadata === "object"
      ? Object.fromEntries(Object.entries(rawMetadata).map(([key, value]) => [key, String(value)]))
      : {};
  // Paystack webhooks carry no top-level event id — the transaction id (or,
  // failing that, the reference) plus event type is the closest stand-in.
  const dedupeId = paystackEvent.data?.id ?? paystackEvent.data?.reference ?? "unknown";
  return {
    eventId: `${paystackEvent.event}:${dedupeId}`,
    succeeded: paystackEvent.event === "charge.success",
    failed: paystackEvent.event === "charge.failed",
    metadata,
  };
}

function normalizeEvent(gatewayName: string, event: unknown): NormalizedWebhookEvent | null {
  return gatewayName === "paystack" ? normalizePaystackEvent(event) : normalizeStripeEvent(event);
}

export async function handleWebhook(gatewayName: string, rawBody: Buffer, signature: string): Promise<void> {
  const { valid, event } = getGateway(gatewayName).verifyWebhook(rawBody, signature);
  if (!valid || !event) {
    throw new ValidationError("Invalid webhook signature");
  }

  const normalized = normalizeEvent(gatewayName, event);
  if (!normalized) {
    return; // an event type we don't act on
  }

  // Replay/duplicate-delivery protection (Phase 5.2): both gateways promise
  // only "at least once" delivery, and Paystack's HMAC signature carries no
  // timestamp at all (unlike Stripe's, which constructEvent already checks
  // internally), so a captured valid (signature, body) pair has no built-in
  // expiry. This is a time-boxed dedupe, not a permanent one — the deeper,
  // permanent guard is the payment.status check below (a payment can only
  // ever leave "pending" once), which this exists alongside rather than
  // replaces.
  const dedupeKey = `webhook:processed:${gatewayName}:${normalized.eventId}`;
  const firstDelivery = await redis.set(dedupeKey, "1", "EX", WEBHOOK_DEDUPE_TTL_S, "NX");
  if (!firstDelivery) {
    logger.info({ gateway: gatewayName, eventId: normalized.eventId }, "duplicate webhook delivery ignored");
    return;
  }

  const paymentId = normalized.metadata.paymentId;
  if (!paymentId) {
    logger.warn({ gateway: gatewayName }, "webhook missing paymentId metadata");
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

  if (normalized.failed) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "failed", rawWebhook: event as unknown as Prisma.InputJsonValue },
    });
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "paid", rawWebhook: event as unknown as Prisma.InputJsonValue },
  });

  if (payment.tripId) {
    await markTripPaid(payment.tripId, payment.amount);
  } else if (normalized.metadata.type === "subscription_purchase") {
    const planId = normalized.metadata.planId;
    if (!planId) {
      logger.warn({ paymentId: payment.id }, "subscription_purchase webhook missing planId metadata");
      return;
    }
    await activateSubscriptionFromPayment(payment.userId, planId);
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
