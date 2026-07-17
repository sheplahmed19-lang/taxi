import { describe, expect, it } from "vitest";
import { findZoneContaining } from "../src/modules/zones/service.js";

// Relies on the seed script's "Test Zone — Downtown" polygon:
// lng 31.20-31.25, lat 30.02-30.07 (see src/db/seed.ts).

describe("zones findZoneContaining", () => {
  it("finds the zone containing a point inside its polygon", async () => {
    const zone = await findZoneContaining({ lat: 30.05, lng: 31.23 });
    expect(zone).not.toBeNull();
    expect(zone!.name).toBe("Test Zone — Downtown");
  });

  it("returns null for a point outside every zone", async () => {
    const zone = await findZoneContaining({ lat: 29.5, lng: 31.0 });
    expect(zone).toBeNull();
  });
});
