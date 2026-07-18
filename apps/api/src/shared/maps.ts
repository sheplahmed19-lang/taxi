import { redis } from "./redis.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Route {
  distanceM: number;
  durationS: number;
}

const CACHE_TTL_S = 60 * 60;
const AVERAGE_CITY_SPEED_KMH = 30;

function cacheKey(pickup: LatLng, drop: LatLng): string {
  // Round to ~11m precision so nearby-identical requests share a cache entry.
  const round = (n: number) => n.toFixed(4);
  return `route:${round(pickup.lat)},${round(pickup.lng)}:${round(drop.lat)},${round(drop.lng)}`;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line distance scaled up for real road routing, at a fixed average city speed. */
function fallbackRoute(pickup: LatLng, drop: LatLng): Route {
  const straightLineM = haversineMeters(pickup, drop);
  const distanceM = Math.round(straightLineM * 1.3); // roads aren't straight lines
  const durationS = Math.round((distanceM / 1000 / AVERAGE_CITY_SPEED_KMH) * 3600);
  return { distanceM, durationS };
}

interface DirectionsResponse {
  status: string;
  routes: Array<{
    legs: Array<{
      distance: { value: number };
      duration: { value: number };
    }>;
  }>;
}

async function fetchFromGoogle(pickup: LatLng, drop: LatLng): Promise<Route | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", `${pickup.lat},${pickup.lng}`);
  url.searchParams.set("destination", `${drop.lat},${drop.lng}`);
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY);

  const response = await fetch(url);
  const body = (await response.json()) as DirectionsResponse;

  if (body.status === "ZERO_RESULTS") {
    return null;
  }
  if (body.status !== "OK") {
    throw new Error(`Directions API error: ${body.status}`);
  }

  const leg = body.routes[0]?.legs[0];
  if (!leg) {
    return null;
  }

  return { distanceM: leg.distance.value, durationS: leg.duration.value };
}

/**
 * Returns route distance/duration between two points, or null if no route
 * exists. Results are cached in Redis for CACHE_TTL_S. Falls back to a
 * haversine-based estimate when GOOGLE_MAPS_API_KEY isn't configured —
 * same dev-friendly pattern as OTP-logs-instead-of-SMS and FCM's no-op.
 */
export async function getRoute(pickup: LatLng, drop: LatLng): Promise<Route | null> {
  const key = cacheKey(pickup, drop);
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached) as Route;
  }

  let route: Route | null;
  if (env.GOOGLE_MAPS_API_KEY) {
    route = await fetchFromGoogle(pickup, drop);
  } else {
    logger.debug("GOOGLE_MAPS_API_KEY not configured — using haversine fallback (dev only)");
    route = fallbackRoute(pickup, drop);
  }

  if (route) {
    await redis.set(key, JSON.stringify(route), "EX", CACHE_TTL_S);
  }

  return route;
}
