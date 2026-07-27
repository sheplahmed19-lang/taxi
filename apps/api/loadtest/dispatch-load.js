// Phase 5.1 load test: k6 script hitting POST /api/v1/trips (the actual
// dispatch-cascade entry point — createTripRecord + attemptDispatch) at a
// precise target rate via k6's constant-arrival-rate executor. Run
// driver-simulator.mjs alongside this (started first) so offered trips
// actually get accepted instead of cycling every online driver's timeout.
//
// Usage: node prepare.mjs && node driver-simulator.mjs & k6 run dispatch-load.js
// See README.md for the full recipe and this sandbox's measured results.
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";
import exec from "k6/execution";

const fixtures = JSON.parse(open("./.fixtures.json"));
const BASE_URL = __ENV.LOADTEST_BASE_URL || "http://localhost:4000";
const RATE_PER_MIN = Number(__ENV.LOADTEST_RATE_PER_MIN || 50);
const DURATION = __ENV.LOADTEST_DURATION || "1m";

const dispatchErrors = new Counter("dispatch_errors");
const dispatchLatency = new Trend("dispatch_latency_ms", true);

export const options = {
  scenarios: {
    dispatch_rate: {
      executor: "constant-arrival-rate",
      rate: RATE_PER_MIN,
      timeUnit: "1m",
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 200,
    },
  },
  thresholds: {
    dispatch_errors: ["count==0"],
    http_req_duration: ["p(95)<2000"],
  },
};

function jitter(point, maxKm) {
  const deg = maxKm * 0.009;
  return { lat: point.lat + (Math.random() * 2 - 1) * deg, lng: point.lng + (Math.random() * 2 - 1) * deg };
}

export default function () {
  // Every iteration needs a rider with no other active trip. k6 VUs don't
  // share JS state, so a hand-rolled VU/iteration index is the obvious
  // move — but (__VU * 1000 + __ITER) % riders.length collided constantly
  // here (1000 and riders.length=300 aren't coprime, so it cycles through
  // only 3 distinct values), sending most iterations back to a rider who
  // already had an active trip and failing them with 409. k6's own global
  // monotonic counter has no such resonance risk.
  const index = exec.scenario.iterationInTest % fixtures.riders.length;
  const rider = fixtures.riders[index];

  const payload = JSON.stringify({
    pickup: jitter(fixtures.pickup, 0.5),
    drop: jitter(fixtures.drop, 0.5),
    vehicleTypeId: fixtures.vehicleTypeId,
    paymentMethod: "cash",
  });

  const res = http.post(`${BASE_URL}/api/v1/trips`, payload, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${rider.token}` },
  });

  const ok = check(res, {
    "status is 201": (r) => r.status === 201,
  });
  if (!ok) {
    dispatchErrors.add(1);
    console.error(`trip creation failed: ${res.status} ${res.body}`);
  }
  dispatchLatency.add(res.timings.duration);
}
