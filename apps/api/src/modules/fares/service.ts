// fares module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import type { VehicleType } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { calculateFare, type FareBreakdown, type PeakRule } from "./engine.js";
import { findZoneContaining } from "../zones/service.js";
import { getRoute, type LatLng } from "../../shared/maps.js";
import { NoRouteFoundError, NotFoundError } from "../../shared/errors.js";

export interface FareEstimate {
  vehicleTypeId: string;
  vehicleTypeName: string;
  distanceM: number;
  durationS: number;
  breakdown: FareBreakdown;
}

function toEngineVehicleType(vt: VehicleType): {
  baseFare: number;
  perKm: number;
  perMin: number;
  minFare: number;
  nightMultiplier: number;
  nightStart: string;
  nightEnd: string;
  peakRules: PeakRule[] | null;
} {
  return {
    baseFare: vt.baseFare,
    perKm: vt.perKm,
    perMin: vt.perMin,
    minFare: vt.minFare,
    nightMultiplier: vt.nightMultiplier.toNumber(),
    nightStart: vt.nightStart ?? "22:00",
    nightEnd: vt.nightEnd ?? "06:00",
    peakRules: (vt.peakRules as PeakRule[] | null) ?? null,
  };
}

export async function estimateFares(
  pickup: LatLng,
  drop: LatLng,
  vehicleTypeId?: string,
): Promise<FareEstimate[]> {
  const [zone, route, vehicleTypes] = await Promise.all([
    findZoneContaining(pickup),
    getRoute(pickup, drop),
    vehicleTypeId
      ? prisma.vehicleType.findMany({ where: { id: vehicleTypeId, active: true } })
      : prisma.vehicleType.findMany({ where: { active: true } }),
  ]);

  if (vehicleTypeId && vehicleTypes.length === 0) {
    throw new NotFoundError("Vehicle type not found or inactive");
  }

  if (!route) {
    throw new NoRouteFoundError();
  }

  return vehicleTypes.map((vt) => ({
    vehicleTypeId: vt.id,
    vehicleTypeName: vt.name,
    distanceM: route.distanceM,
    durationS: route.durationS,
    breakdown: calculateFare({
      vehicleType: toEngineVehicleType(vt),
      zoneOverrides: zone?.fareOverrides ?? undefined,
      distanceM: route.distanceM,
      durationS: route.durationS,
      timestamp: new Date(),
    }),
  }));
}
