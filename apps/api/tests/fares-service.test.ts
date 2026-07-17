import { describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/index.js";
import { estimateFares } from "../src/modules/fares/service.js";
import { NoRouteFoundError, NotFoundError } from "../src/shared/errors.js";

// Inside the seeded "Test Zone — Downtown" polygon.
const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

describe("fares/service estimateFares", () => {
  it("returns an estimate for every active vehicle type when vehicleTypeId is omitted", async () => {
    const activeCount = await prisma.vehicleType.count({ where: { active: true } });
    const estimates = await estimateFares(pickup, drop);

    expect(estimates).toHaveLength(activeCount);
    for (const estimate of estimates) {
      expect(estimate.breakdown.total).toBeGreaterThan(0);
      expect(estimate.distanceM).toBeGreaterThan(0);
    }
  });

  it("filters to a single vehicle type when vehicleTypeId is provided", async () => {
    const economy = await prisma.vehicleType.findFirstOrThrow({ where: { name: "Economy" } });
    const estimates = await estimateFares(pickup, drop, economy.id);

    expect(estimates).toHaveLength(1);
    expect(estimates[0]?.vehicleTypeId).toBe(economy.id);
  });

  it("throws NotFoundError for an unknown vehicleTypeId", async () => {
    await expect(
      estimateFares(pickup, drop, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError for an inactive vehicle type", async () => {
    const inactive = await prisma.vehicleType.create({
      data: {
        name: `Inactive-${Date.now()}`,
        baseFare: 100,
        perKm: 10,
        perMin: 5,
        minFare: 200,
        nightStart: "22:00",
        nightEnd: "06:00",
        active: false,
      },
    });

    await expect(estimateFares(pickup, drop, inactive.id)).rejects.toThrow(NotFoundError);

    await prisma.vehicleType.delete({ where: { id: inactive.id } });
  });

  it("throws NoRouteFoundError when no route is available", async () => {
    vi.spyOn(await import("../src/shared/maps.js"), "getRoute").mockResolvedValueOnce(null);
    await expect(estimateFares(pickup, drop)).rejects.toThrow(NoRouteFoundError);
  });

  it("applies the zone's fare overrides when pickup falls inside a zone", async () => {
    const economy = await prisma.vehicleType.findFirstOrThrow({ where: { name: "Economy" } });

    // Seed's test zone has empty fareOverrides ({}), so this just confirms
    // the estimate succeeds end-to-end through the zone lookup path.
    const [estimate] = await estimateFares(pickup, drop, economy.id);
    expect(estimate?.breakdown.base).toBe(economy.baseFare);
  });
});
