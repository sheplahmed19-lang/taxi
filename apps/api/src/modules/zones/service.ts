// zones module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import type { LatLng } from "../../shared/maps.js";

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
