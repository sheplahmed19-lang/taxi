/**
 * Pure fare calculation function — no I/O, no DB access. See docs/plan.md
 * Section 5, task 1.1.
 *
 * `timestamp`'s UTC hour/minute are treated as the trip's local wall-clock
 * time for night/peak window comparisons. This function must be deterministic
 * given identical inputs regardless of the host process's TZ setting, so it
 * never uses Date's local-timezone accessors (getHours/getMinutes) — callers
 * are responsible for constructing `timestamp` so its UTC fields already
 * reflect the operating city's local time.
 */
export interface PeakRule {
  start: string; // "HH:MM", 24-hour
  end: string; // "HH:MM", 24-hour — may be < start to span midnight
  multiplier: number;
}

export interface FareEngineInput {
  vehicleType: {
    baseFare: number;
    perKm: number;
    perMin: number;
    minFare: number;
    nightMultiplier: number;
    nightStart: string; // "HH:MM"
    nightEnd: string; // "HH:MM" — may be < nightStart to span midnight
    peakRules?: PeakRule[] | null;
  };
  zoneOverrides?: Partial<{
    baseFare: number;
    perKm: number;
    perMin: number;
    minFare: number;
    nightMultiplier: number;
    nightStart: string;
    nightEnd: string;
    peakRules: PeakRule[] | null;
  }>;
  distanceM: number;
  durationS: number;
  timestamp: Date;
  surgeMultiplier?: number;
  promo?: { type: "flat" | "percent"; value: number; maxDiscount?: number } | null;
  currency?: string;
}

export interface FareBreakdown {
  base: number;
  distanceFare: number;
  timeFare: number;
  nightOrPeakMultiplier: number;
  surge: number;
  promoDiscount: number;
  total: number;
  currency: string;
}

function timeToMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function isWithinWindow(nowMinutes: number, start: string, end: string): boolean {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);

  if (startMinutes === endMinutes) {
    return false;
  }

  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  // Window spans midnight (e.g. 22:00 -> 06:00).
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function resolveNightOrPeakMultiplier(
  timestamp: Date,
  config: {
    nightMultiplier: number;
    nightStart: string;
    nightEnd: string;
    peakRules?: PeakRule[] | null;
  },
): number {
  const nowMinutes = timestamp.getUTCHours() * 60 + timestamp.getUTCMinutes();

  if (isWithinWindow(nowMinutes, config.nightStart, config.nightEnd)) {
    return config.nightMultiplier;
  }

  for (const rule of config.peakRules ?? []) {
    if (isWithinWindow(nowMinutes, rule.start, rule.end)) {
      return rule.multiplier;
    }
  }

  return 1;
}

/**
 * Isolated from calculateFare so callers that already hold a pre-discount
 * total (e.g. trips/service.ts re-locking a promo's terms against a
 * newly-measured final fare at trip completion, without re-running the
 * whole route/zone/night-window pipeline) can apply the same capping rules
 * without duplicating them.
 */
export function applyPromoDiscount(
  preDiscountTotal: number,
  promo?: FareEngineInput["promo"],
): { promoDiscount: number; total: number } {
  if (!promo) {
    return { promoDiscount: 0, total: preDiscountTotal };
  }

  const raw = promo.type === "flat" ? promo.value : Math.round(preDiscountTotal * (promo.value / 100));
  const capped = promo.maxDiscount !== undefined ? Math.min(raw, promo.maxDiscount) : raw;
  const promoDiscount = Math.min(capped, preDiscountTotal);

  return { promoDiscount, total: Math.max(preDiscountTotal - promoDiscount, 0) };
}

export function calculateFare(input: FareEngineInput): FareBreakdown {
  const effective = { ...input.vehicleType, ...input.zoneOverrides };
  const currency = input.currency ?? "EGP";
  const surge = input.surgeMultiplier ?? 1;

  const base = effective.baseFare;
  const distanceFare = Math.round(effective.perKm * (input.distanceM / 1000));
  const timeFare = Math.round(effective.perMin * (input.durationS / 60));

  const nightOrPeakMultiplier = resolveNightOrPeakMultiplier(input.timestamp, effective);

  const rawTotal = Math.round((base + distanceFare + timeFare) * nightOrPeakMultiplier * surge);
  const preDiscountTotal = Math.max(rawTotal, effective.minFare);

  const { promoDiscount, total } = applyPromoDiscount(preDiscountTotal, input.promo);

  return {
    base,
    distanceFare,
    timeFare,
    nightOrPeakMultiplier,
    surge,
    promoDiscount,
    total,
    currency,
  };
}
