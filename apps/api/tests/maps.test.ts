import { afterAll, describe, expect, it } from "vitest";
import { redis } from "../src/shared/redis.js";
import { getRoute } from "../src/shared/maps.js";

// Two points ~7.4km apart (roughly Cairo downtown to Giza), used to sanity
// check the haversine fallback since GOOGLE_MAPS_API_KEY isn't configured
// in tests.
const pickup = { lat: 30.0444, lng: 31.2357 };
const drop = { lat: 30.0131, lng: 31.2089 };

describe("shared/maps getRoute (haversine fallback)", () => {
  afterAll(async () => {
    await redis.del("route:30.0444,31.2357:30.0131,31.2089");
  });

  it("returns a plausible distance/duration for two real-world points", async () => {
    const route = await getRoute(pickup, drop);
    expect(route).not.toBeNull();
    // Straight-line distance is ~4.1km; the 1.3x road-factor puts this well
    // under 10km and comfortably above the straight-line distance.
    expect(route!.distanceM).toBeGreaterThan(4000);
    expect(route!.distanceM).toBeLessThan(10000);
    expect(route!.durationS).toBeGreaterThan(0);
  });

  it("returns zero distance/duration for identical points", async () => {
    const route = await getRoute(pickup, pickup);
    expect(route).toEqual({ distanceM: 0, durationS: 0 });
  });

  it("caches the result so a manually-poisoned cache entry is returned instead of recomputing", async () => {
    const key = "route:30.0444,31.2357:30.0131,31.2089";
    await getRoute(pickup, drop); // populate the cache under the real key
    await redis.set(key, JSON.stringify({ distanceM: 999, durationS: 999 }), "EX", 60);

    const route = await getRoute(pickup, drop);
    expect(route).toEqual({ distanceM: 999, durationS: 999 });
  });
});
