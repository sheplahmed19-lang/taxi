// promos module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import type { Prisma, PromoCode } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { applyPromoDiscount, type FareEngineInput } from "../fares/engine.js";
import { estimateFares } from "../fares/service.js";
import { findZoneContaining } from "../zones/service.js";
import type { LatLng } from "../../shared/maps.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";

export type PromoTerms = NonNullable<FareEngineInput["promo"]>;

export interface ValidatedPromo {
  id: string;
  code: string;
  type: PromoTerms["type"];
  value: number;
  maxDiscount?: number;
}

function toValidated(promo: PromoCode): ValidatedPromo {
  return {
    id: promo.id,
    code: promo.code,
    type: promo.type,
    value: promo.value,
    maxDiscount: promo.maxDiscount ?? undefined,
  };
}

async function findActivePromo(code: string): Promise<PromoCode> {
  const promo = await prisma.promoCode.findUnique({ where: { code: code.toUpperCase() } });
  if (!promo || !promo.active) {
    throw new NotFoundError("Invalid promo code");
  }
  return promo;
}

interface EligibilityContext {
  userId: string;
  vehicleTypeId: string;
  zoneId: string | null;
  preDiscountFare: number;
}

async function checkEligibility(promo: PromoCode, ctx: EligibilityContext): Promise<void> {
  const now = new Date();
  if (promo.validFrom && now < promo.validFrom) {
    throw new ConflictError("This promo isn't active yet");
  }
  if (promo.validUntil && now > promo.validUntil) {
    throw new ConflictError("This promo has expired");
  }
  if (promo.minFare !== null && ctx.preDiscountFare < promo.minFare) {
    throw new ConflictError(`This promo requires a minimum fare of ${promo.minFare}`);
  }
  if (promo.vehicleTypeIds.length > 0 && !promo.vehicleTypeIds.includes(ctx.vehicleTypeId)) {
    throw new ConflictError("This promo isn't valid for the selected vehicle type");
  }
  if (promo.zoneIds.length > 0 && (!ctx.zoneId || !promo.zoneIds.includes(ctx.zoneId))) {
    throw new ConflictError("This promo isn't valid for the selected pickup location");
  }
  if (promo.usageLimit !== null) {
    const count = await prisma.promoRedemption.count({ where: { promoId: promo.id } });
    if (count >= promo.usageLimit) {
      throw new ConflictError("This promo has reached its usage limit");
    }
  }
  if (promo.perUserLimit !== null) {
    const count = await prisma.promoRedemption.count({ where: { promoId: promo.id, userId: ctx.userId } });
    if (count >= promo.perUserLimit) {
      throw new ConflictError("You've already used this promo the maximum number of times");
    }
  }
}

export interface PromoRideContext {
  userId: string;
  vehicleTypeId: string;
  pickup: LatLng;
  preDiscountFare: number;
}

/**
 * Looks up `code`, checks every eligibility rule (window, min fare, vehicle
 * type, zone, usage limits) against the given ride context, and returns its
 * lean discount terms if it passes. Throws NotFoundError/ConflictError on
 * the first failing rule. Used both by the no-side-effects /promos/validate
 * preview and by trips/service.ts when actually attaching a promo to a trip.
 */
export async function resolveAndValidatePromo(code: string, ctx: PromoRideContext): Promise<ValidatedPromo> {
  const promo = await findActivePromo(code);
  const zone = await findZoneContaining(ctx.pickup);
  await checkEligibility(promo, {
    userId: ctx.userId,
    vehicleTypeId: ctx.vehicleTypeId,
    zoneId: zone?.id ?? null,
    preDiscountFare: ctx.preDiscountFare,
  });
  return toValidated(promo);
}

/** Raw discount terms by id, with no eligibility re-check — see calculateFinalFare's promo param doc. */
export async function getPromoDiscountTerms(promoId: string): Promise<PromoTerms | null> {
  const promo = await prisma.promoCode.findUnique({ where: { id: promoId } });
  if (!promo) {
    return null;
  }
  return { type: promo.type, value: promo.value, maxDiscount: promo.maxDiscount ?? undefined };
}

export async function recordPromoRedemption(promoId: string, userId: string, tripId: string): Promise<void> {
  await prisma.promoRedemption.create({ data: { promoId, userId, tripId } });
}

/** Frees up a redemption slot when the trip it was attached to gets cancelled. */
export async function releasePromoRedemption(tripId: string): Promise<void> {
  await prisma.promoRedemption.deleteMany({ where: { tripId } });
}

export interface PromoPreview {
  promo: ValidatedPromo;
  preDiscountTotal: number;
  promoDiscount: number;
  total: number;
}

/** POST /promos/validate — read-only, safe to call on every keystroke while the rider types a code. */
export async function previewPromo(
  userId: string,
  code: string,
  pickup: LatLng,
  drop: LatLng,
  vehicleTypeId: string,
): Promise<PromoPreview> {
  const [estimate] = await estimateFares(pickup, drop, vehicleTypeId);
  if (!estimate) {
    throw new NotFoundError("Vehicle type not found or inactive");
  }

  const promo = await resolveAndValidatePromo(code, {
    userId,
    vehicleTypeId,
    pickup,
    preDiscountFare: estimate.breakdown.total,
  });

  const { promoDiscount, total } = applyPromoDiscount(estimate.breakdown.total, promo);

  return { promo, preDiscountTotal: estimate.breakdown.total, promoDiscount, total };
}

// ── Admin CRUD ──────────────────────────────────────────────────────────

export async function listPromos(): Promise<PromoCode[]> {
  return prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } });
}

export interface PromoInput {
  code: string;
  type: "flat" | "percent";
  value: number;
  maxDiscount?: number;
  usageLimit?: number;
  perUserLimit?: number;
  validFrom?: Date;
  validUntil?: Date;
  minFare?: number;
  vehicleTypeIds: string[];
  zoneIds: string[];
  active: boolean;
}

export async function createPromo(data: PromoInput): Promise<PromoCode> {
  return prisma.promoCode.create({ data: { ...data, code: data.code.toUpperCase() } });
}

export async function updatePromo(id: string, data: Partial<PromoInput>): Promise<PromoCode> {
  const promo = await prisma.promoCode.findUnique({ where: { id } });
  if (!promo) {
    throw new NotFoundError("Promo not found");
  }
  return prisma.promoCode.update({
    where: { id },
    data: {
      ...data,
      code: data.code ? data.code.toUpperCase() : undefined,
    } as Prisma.PromoCodeUpdateInput,
  });
}

export async function deletePromo(id: string): Promise<void> {
  const promo = await prisma.promoCode.findUnique({ where: { id } });
  if (!promo) {
    throw new NotFoundError("Promo not found");
  }
  const redemptions = await prisma.promoRedemption.count({ where: { promoId: id } });
  if (redemptions > 0) {
    throw new ConflictError("This promo has already been redeemed — deactivate it instead of deleting it");
  }
  await prisma.promoCode.delete({ where: { id } });
}
