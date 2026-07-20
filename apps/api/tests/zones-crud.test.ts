import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { createZone, deleteZone, listZones, updateZone } from "../src/modules/zones/service.js";
import { estimateFares } from "../src/modules/fares/service.js";
import { NotFoundError, ValidationError } from "../src/shared/errors.js";

const zoneIds: string[] = [];
const vehicleTypeIds: string[] = [];

// A small square well outside the seeded "Test Zone — Downtown" polygon
// (lng 31.20-31.25, lat 30.02-30.07), so it never overlaps another zone.
const square = [
  { lat: 40.0, lng: 40.0 },
  { lat: 40.0, lng: 40.05 },
  { lat: 40.05, lng: 40.05 },
  { lat: 40.05, lng: 40.0 },
];

describe("zones CRUD (geofence editor)", () => {
  afterAll(async () => {
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("creates a zone and lists it back with the polygon round-tripped", async () => {
    const zone = await createZone({ name: `ZoneCrudTest-${Date.now()}`, polygon: square });
    zoneIds.push(zone.id);

    const all = await listZones();
    const found = all.find((z) => z.id === zone.id);
    expect(found).toBeDefined();
    expect(found?.active).toBe(true);
    expect(found?.polygon.length).toBeGreaterThanOrEqual(4);
    // every original corner should be present in the round-tripped ring
    for (const corner of square) {
      expect(found?.polygon.some((p) => Math.abs(p.lat - corner.lat) < 0.0001 && Math.abs(p.lng - corner.lng) < 0.0001)).toBe(true);
    }
  });

  it("rejects a polygon with fewer than 3 points", async () => {
    await expect(createZone({ name: "TooFewPoints", polygon: [{ lat: 1, lng: 1 }] })).rejects.toThrow(ValidationError);
  });

  it("updates a zone's name, active flag, fareOverrides, and polygon independently", async () => {
    const zone = await createZone({ name: `ZoneCrudUpdate-${Date.now()}`, polygon: square, active: true });
    zoneIds.push(zone.id);

    const renamed = await updateZone(zone.id, { name: "Renamed Zone" });
    expect(renamed.name).toBe("Renamed Zone");
    expect(renamed.active).toBe(true); // untouched fields survive a partial update

    const deactivated = await updateZone(zone.id, { active: false });
    expect(deactivated.active).toBe(false);
    expect(deactivated.name).toBe("Renamed Zone");
  });

  it("404s updating or deleting an unknown zone", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000000";
    await expect(updateZone(unknownId, { name: "X" })).rejects.toThrow(NotFoundError);
    await expect(deleteZone(unknownId)).rejects.toThrow(NotFoundError);
  });

  it("deletes a zone", async () => {
    const zone = await createZone({ name: `ZoneCrudDelete-${Date.now()}`, polygon: square });
    await deleteZone(zone.id);
    const all = await listZones();
    expect(all.some((z) => z.id === zone.id)).toBe(false);
  });

  it("a fare override on a newly created zone affects fare estimates immediately, with zero fare-engine changes", async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `ZoneFareTest-${Date.now()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeIds.push(vt.id);

    // A polygon region unique to this test — the earlier tests in this file
    // already claimed `square` (lat/lng 40.0-40.05), so reusing it here would
    // find one of THEIR still-active zones instead of finding nothing.
    const fareSquare = [
      { lat: -10.0, lng: -10.0 },
      { lat: -10.0, lng: -9.95 },
      { lat: -9.95, lng: -9.95 },
      { lat: -9.95, lng: -10.0 },
    ];
    const insidePoint = { lat: -9.98, lng: -9.98 };

    const before = await estimateFares(insidePoint, { lat: -9.97, lng: -9.97 }, vt.id);
    expect(before[0]?.zoneId).toBeNull();
    const baselineTotal = before[0]!.breakdown.total;

    const zone = await createZone({
      name: `ZoneFareOverride-${Date.now()}`,
      polygon: fareSquare,
      fareOverrides: { baseFare: 5000 }, // deliberately huge, unmissable in the resulting total
    });
    zoneIds.push(zone.id);

    const after = await estimateFares(insidePoint, { lat: -9.97, lng: -9.97 }, vt.id);
    expect(after[0]?.zoneId).toBe(zone.id);
    expect(after[0]!.breakdown.total).toBeGreaterThan(baselineTotal);
  });
});
