// fares module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import type { VehicleType } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { calculateFare, type FareBreakdown, type FareEngineInput, type PeakRule } from "./engine.js";
import { findZoneContaining } from "../zones/service.js";
import { getRoute, type LatLng } from "../../shared/maps.js";
import { NoRouteFoundError, NotFoundError } from "../../shared/errors.js";

export interface FareEstimate {
  vehicleTypeId: string;
  vehicleTypeName: string;
  distanceM: number;
  durationS: number;
  zoneId: string | null;
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
    zoneId: zone?.id ?? null,
    breakdown: calculateFare({
      vehicleType: toEngineVehicleType(vt),
      zoneOverrides: zone?.fareOverrides ?? undefined,
      distanceM: route.distanceM,
      durationS: route.durationS,
      timestamp: new Date(),
    }),
  }));
}

/**
 * Final fare at trip completion, from actually-measured distance/duration
 * (as opposed to estimateFares' pre-trip route estimate). Used by
 * trips/service.ts:completeTrip.
 *
 * `promo`, when passed, is the trip's already-attached promo's raw terms —
 * re-applied against the newly-measured total but never re-validated
 * (limits/windows/zone eligibility were already checked once, when the
 * promo was attached; "locking" it means completion honors that decision
 * regardless of what may have changed about the promo since).
 */
export async function calculateFinalFare(
  pickup: LatLng,
  vehicleTypeId: string,
  distanceM: number,
  durationS: number,
  promo?: FareEngineInput["promo"],
): Promise<FareBreakdown> {
  const [zone, vehicleType] = await Promise.all([
    findZoneContaining(pickup),
    prisma.vehicleType.findUnique({ where: { id: vehicleTypeId } }),
  ]);

  if (!vehicleType) {
    throw new NotFoundError("Vehicle type not found");
  }

  return calculateFare({
    vehicleType: toEngineVehicleType(vehicleType),
    zoneOverrides: zone?.fareOverrides ?? undefined,
    distanceM,
    durationS,
    timestamp: new Date(),
    promo,
  });
}
