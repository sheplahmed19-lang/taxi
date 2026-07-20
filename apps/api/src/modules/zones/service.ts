// zones module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import type { LatLng } from "../../shared/maps.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";

export interface ZoneMatch {
  id: string;
  name: string;
  fareOverrides: Record<string, unknown> | null;
}

/** Finds the first active zone whose polygon contains `point`, or null if none does. */
export async function findZoneContaining(point: LatLng): Promise<ZoneMatch | null> {
  const rows = await prisma.$queryRaw<ZoneMatch[]>`
    SELECT id, name, fare_overrides AS "fareOverrides"
    FROM zones
    WHERE active = true
      AND ST_Contains(polygon, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326))
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ── Geofence editor (Phase 4.4) ─────────────────────────────────────────────
// Fare overrides are already live-wired: fares/service.ts calls
// findZoneContaining and shallow-merges its fareOverrides on top of the
// vehicle type's base rates (fares/engine.ts) — so a zone created/edited
// here affects fare estimates immediately, zero fare-engine changes needed.

export interface ZoneListEntry {
  id: string;
  name: string;
  active: boolean;
  fareOverrides: Record<string, unknown> | null;
  polygon: Array<{ lat: number; lng: number }>;
}

interface GeoJsonPolygon {
  coordinates: number[][][];
}

function geoJsonToRing(geojson: GeoJsonPolygon): Array<{ lat: number; lng: number }> {
  const ring = geojson.coordinates[0] ?? [];
  return ring.map(([lng, lat]) => ({ lat: lat as number, lng: lng as number }));
}

export async function listZones(): Promise<ZoneListEntry[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; active: boolean; fareOverrides: unknown; geojson: string | null }>
  >`
    SELECT id, name, active, fare_overrides AS "fareOverrides", ST_AsGeoJSON(polygon) AS geojson
    FROM zones
    ORDER BY name
  `;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    active: row.active,
    fareOverrides: row.fareOverrides as Record<string, unknown> | null,
    polygon: row.geojson ? geoJsonToRing(JSON.parse(row.geojson) as GeoJsonPolygon) : [],
  }));
}

/** WKT ring — closes the polygon if the caller didn't repeat the first point as the last. */
function ringToWkt(polygon: Array<{ lat: number; lng: number }>): string {
  const points = [...polygon];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first.lat !== last.lat || first.lng !== last.lng) {
    points.push(first);
  }
  return `POLYGON((${points.map((p) => `${p.lng} ${p.lat}`).join(", ")}))`;
}

export interface ZoneInput {
  name: string;
  active?: boolean;
  fareOverrides?: Record<string, unknown> | null;
  polygon: Array<{ lat: number; lng: number }>;
}

export async function createZone(input: ZoneInput) {
  if (input.polygon.length < 3) {
    throw new ValidationError("A zone polygon needs at least 3 points");
  }

  const zone = await prisma.zone.create({
    data: {
      name: input.name,
      active: input.active ?? true,
      fareOverrides: input.fareOverrides === null ? undefined : (input.fareOverrides as never),
    },
  });

  await prisma.$executeRaw`
    UPDATE zones SET polygon = ST_GeomFromText(${ringToWkt(input.polygon)}, 4326) WHERE id = ${zone.id}
  `;

  return zone;
}

export async function updateZone(id: string, input: Partial<ZoneInput>) {
  const existing = await prisma.zone.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Zone not found");
  }
  if (input.polygon && input.polygon.length < 3) {
    throw new ValidationError("A zone polygon needs at least 3 points");
  }

  await prisma.zone.update({
    where: { id },
    data: {
      name: input.name,
      active: input.active,
      fareOverrides: input.fareOverrides === undefined ? undefined : (input.fareOverrides as never),
    },
  });

  if (input.polygon) {
    await prisma.$executeRaw`
      UPDATE zones SET polygon = ST_GeomFromText(${ringToWkt(input.polygon)}, 4326) WHERE id = ${id}
    `;
  }

  return prisma.zone.findUniqueOrThrow({ where: { id } });
}

export async function deleteZone(id: string): Promise<void> {
  const existing = await prisma.zone.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Zone not found");
  }
  await prisma.zone.delete({ where: { id } });
}
