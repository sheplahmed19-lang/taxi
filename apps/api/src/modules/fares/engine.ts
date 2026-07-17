/**
 * Pure fare calculation function — no I/O, no DB access.
 * Implemented in Phase 1.1. See docs/plan.md Section 5, task 1.1.
 */
export interface FareEngineInput {
  vehicleType: {
    baseFare: number;
    perKm: number;
    perMin: number;
    minFare: number;
    nightMultiplier: number;
    nightStart: string;
    nightEnd: string;
    peakRules?: unknown;
  };
  zoneOverrides?: Record<string, unknown>;
  distanceM: number;
  durationS: number;
  timestamp: Date;
  surgeMultiplier?: number;
  promo?: { type: "flat" | "percent"; value: number; maxDiscount?: number } | null;
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

export function calculateFare(_input: FareEngineInput): FareBreakdown {
  throw new Error("calculateFare not yet implemented — see docs/plan.md Phase 1.1");
}
