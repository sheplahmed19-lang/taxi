import { describe, expect, it } from "vitest";
import { applyPromoDiscount, calculateFare, type FareEngineInput } from "../src/modules/fares/engine.js";

const baseVehicleType: FareEngineInput["vehicleType"] = {
  baseFare: 500,
  perKm: 150,
  perMin: 20,
  minFare: 1000,
  nightMultiplier: 1.25,
  nightStart: "22:00",
  nightEnd: "06:00",
  peakRules: [
    { start: "07:00", end: "09:00", multiplier: 1.3 },
    { start: "17:00", end: "19:00", multiplier: 1.3 },
  ],
};

// 2026-01-01 is a Thursday; times below are read as UTC to stand in for
// "local" wall-clock time per the engine's documented contract.
function at(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 0, 1, h, m));
}

function baseInput(overrides: Partial<FareEngineInput> = {}): FareEngineInput {
  return {
    vehicleType: baseVehicleType,
    distanceM: 5000,
    durationS: 600,
    timestamp: at("12:00"),
    ...overrides,
  };
}

describe("fares/engine calculateFare", () => {
  it("computes an itemized daytime fare with no multipliers", () => {
    const result = calculateFare(baseInput());

    expect(result.base).toBe(500);
    expect(result.distanceFare).toBe(750); // 150 * 5km
    expect(result.timeFare).toBe(200); // 20 * 10min
    expect(result.nightOrPeakMultiplier).toBe(1);
    expect(result.surge).toBe(1);
    expect(result.promoDiscount).toBe(0);
    expect(result.total).toBe(1450); // 500 + 750 + 200
    expect(result.currency).toBe("EGP");
  });

  describe("night window", () => {
    it("applies the night multiplier exactly at the start minute", () => {
      const result = calculateFare(baseInput({ timestamp: at("22:00") }));
      expect(result.nightOrPeakMultiplier).toBe(1.25);
    });

    it("does not apply the night multiplier one minute before the start", () => {
      const result = calculateFare(baseInput({ timestamp: at("21:59") }));
      expect(result.nightOrPeakMultiplier).toBe(1);
    });

    it("applies across the midnight wrap (23:59)", () => {
      const result = calculateFare(baseInput({ timestamp: at("23:59") }));
      expect(result.nightOrPeakMultiplier).toBe(1.25);
    });

    it("applies just before the end boundary (05:59)", () => {
      const result = calculateFare(baseInput({ timestamp: at("05:59") }));
      expect(result.nightOrPeakMultiplier).toBe(1.25);
    });

    it("does not apply at the end boundary (06:00) — window is exclusive of end", () => {
      const result = calculateFare(baseInput({ timestamp: at("06:00") }));
      expect(result.nightOrPeakMultiplier).toBe(1);
    });

    it("multiplies the full subtotal, not just the base fare", () => {
      const result = calculateFare(baseInput({ timestamp: at("23:00") }));
      // (500 + 750 + 200) * 1.25 = 1812.5 -> rounds to 1813
      expect(result.total).toBe(1813);
    });
  });

  describe("peak windows", () => {
    it("applies a peak multiplier during morning rush", () => {
      const result = calculateFare(baseInput({ timestamp: at("08:00") }));
      expect(result.nightOrPeakMultiplier).toBe(1.3);
    });

    it("applies a peak multiplier during evening rush", () => {
      const result = calculateFare(baseInput({ timestamp: at("18:30") }));
      expect(result.nightOrPeakMultiplier).toBe(1.3);
    });

    it("does not apply peak multiplier outside any configured window", () => {
      const result = calculateFare(baseInput({ timestamp: at("14:00") }));
      expect(result.nightOrPeakMultiplier).toBe(1);
    });

    it("prefers the night multiplier over peak when both windows would match", () => {
      const overlapping = {
        ...baseVehicleType,
        nightStart: "17:00",
        nightEnd: "20:00",
      };
      const result = calculateFare(
        baseInput({ vehicleType: overlapping, timestamp: at("18:00") }),
      );
      expect(result.nightOrPeakMultiplier).toBe(overlapping.nightMultiplier);
    });
  });

  describe("min fare floor", () => {
    it("floors a very short trip at the vehicle type's minFare", () => {
      const result = calculateFare(baseInput({ distanceM: 200, durationS: 60 }));
      // base 500 + distanceFare 30 + timeFare 20 = 550, below minFare 1000
      expect(result.total).toBe(1000);
    });

    it("does not floor a trip whose raw total already exceeds minFare", () => {
      const result = calculateFare(baseInput({ distanceM: 10000, durationS: 1200 }));
      expect(result.total).toBeGreaterThan(baseVehicleType.minFare);
    });
  });

  describe("surge", () => {
    it("multiplies the subtotal by the surge factor", () => {
      const result = calculateFare(baseInput({ surgeMultiplier: 2 }));
      expect(result.surge).toBe(2);
      expect(result.total).toBe(2900); // 1450 * 2
    });

    it("defaults surge to 1 when omitted", () => {
      const result = calculateFare(baseInput());
      expect(result.surge).toBe(1);
    });
  });

  describe("promo caps", () => {
    it("applies a flat discount", () => {
      const result = calculateFare(baseInput({ promo: { type: "flat", value: 200 } }));
      expect(result.promoDiscount).toBe(200);
      expect(result.total).toBe(1250);
    });

    it("caps a flat discount at the pre-discount total (never goes negative)", () => {
      const result = calculateFare(
        baseInput({ distanceM: 200, durationS: 60, promo: { type: "flat", value: 5000 } }),
      );
      expect(result.promoDiscount).toBe(1000); // capped at the floored minFare total
      expect(result.total).toBe(0);
    });

    it("applies a percent discount", () => {
      const result = calculateFare(baseInput({ promo: { type: "percent", value: 10 } }));
      expect(result.promoDiscount).toBe(145); // 10% of 1450
      expect(result.total).toBe(1305);
    });

    it("caps a percent discount at maxDiscount", () => {
      const result = calculateFare(
        baseInput({ promo: { type: "percent", value: 50, maxDiscount: 300 } }),
      );
      // 50% of 1450 = 725, capped to 300
      expect(result.promoDiscount).toBe(300);
      expect(result.total).toBe(1150);
    });

    it("applies no discount when promo is null", () => {
      const result = calculateFare(baseInput({ promo: null }));
      expect(result.promoDiscount).toBe(0);
    });
  });

  // applyPromoDiscount is calculateFare's promo math, factored out so
  // trips/service.ts can re-apply a trip's already-attached promo against a
  // freshly-measured completion total without re-running the whole
  // route/zone/night-window pipeline (Phase 3.1's "lock-at-completion").
  describe("applyPromoDiscount (standalone)", () => {
    it("matches calculateFare's discount for the same pre-discount total", () => {
      const viaEngine = calculateFare(baseInput({ promo: { type: "percent", value: 10 } }));
      const standalone = applyPromoDiscount(1450, { type: "percent", value: 10 });
      expect(standalone.promoDiscount).toBe(viaEngine.promoDiscount);
      expect(standalone.total).toBe(viaEngine.total);
    });

    it("returns a zero discount and the input total unchanged when promo is omitted", () => {
      expect(applyPromoDiscount(1450)).toEqual({ promoDiscount: 0, total: 1450 });
    });

    it("never discounts below zero", () => {
      const result = applyPromoDiscount(100, { type: "flat", value: 500 });
      expect(result).toEqual({ promoDiscount: 100, total: 0 });
    });
  });

  describe("zone overrides", () => {
    it("overrides individual vehicle-type fields without affecting the rest", () => {
      const result = calculateFare(
        baseInput({ zoneOverrides: { perKm: 300, minFare: 2000 } }),
      );
      expect(result.distanceFare).toBe(1500); // 300 * 5km, overridden
      expect(result.timeFare).toBe(200); // unchanged from vehicleType
      expect(result.total).toBe(2200); // 500+1500+200=2200, already above the overridden minFare of 2000
    });

    it("zone override of nightStart shifts the night window", () => {
      const result = calculateFare(
        baseInput({
          zoneOverrides: { nightStart: "20:00", nightEnd: "22:00" },
          timestamp: at("20:30"),
        }),
      );
      expect(result.nightOrPeakMultiplier).toBe(baseVehicleType.nightMultiplier);
    });
  });

  it("never returns a negative total", () => {
    const result = calculateFare(
      baseInput({ distanceM: 0, durationS: 0, promo: { type: "flat", value: 999999 } }),
    );
    expect(result.total).toBe(0);
  });
});
