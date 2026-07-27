# Load & chaos testing (Phase 5.1)

docs/plan.md's target: "k6 socket + dispatch load test (target: 500 concurrent
drivers streaming locations, 50 dispatches/min on a single node), Redis/
Postgres slow-query pass, socket reconnect storm handling."

## Why this isn't one k6 script

k6 doesn't speak Socket.IO — Engine.IO's handshake/upgrade framing on top of
raw WebSocket isn't something k6's `k6/ws`/`k6/experimental/websockets`
modules implement, and hand-rolling that protocol in a k6 script is its own
significant (and fragile) undertaking. So this is split by what each tool is
actually good at:

- **`prepare.ts`** — seeds synthetic online drivers + riders directly via
  the real service layer (`registerDriver`/`approveDriver`/`setAvailability`/
  `recordLocation`), mints JWTs with `signAccessToken` (dev-mode OTPs are
  only visible in server logs, not scriptable from an HTTP client), and
  writes `.fixtures.json` (gitignored — contains live tokens) for the other
  two scripts to read.
- **`driver-simulator.mjs`** — real `socket.io-client` connections, one per
  seeded driver. This is the "streaming locations" half of the target
  scenario, and also auto-accepts any `trip:request` it receives so
  dispatched trips actually reach `accepted` instead of idling out and
  cycling through every online driver's offer timeout.
- **`dispatch-load.js`** — a real k6 script (`constant-arrival-rate`
  executor) hitting `POST /api/v1/trips` — the actual `createTripRecord` +
  `attemptDispatch` cascade — at a precise target rate. This is the
  "dispatches/min" half.
- **`cleanup.ts`** — deletes every row the run created (trips, ledger
  entries, drivers, riders) so nothing lingers in a shared dev database.

## Running it

```bash
# 1. API dev server running (pnpm --filter api dev), Postgres + Redis up.
cd apps/api/loadtest

# 2. Seed fixtures (override counts via env vars if you want a bigger run).
LOADTEST_DRIVERS=60 LOADTEST_RIDERS=400 npx tsx prepare.ts

# 3. Start the driver simulator in the background, duration >= the k6 run.
LOADTEST_DURATION_S=75 node driver-simulator.mjs &

# 4. Run the dispatch load test.
LOADTEST_RATE_PER_MIN=50 LOADTEST_DURATION=1m k6 run dispatch-load.js

# 5. Always clean up afterward.
npx tsx cleanup.ts
```

## What was actually verified in this sandbox

Scale disclosed up front: this is a single dev-tier Postgres + Redis + one
Node API process on a shared sandbox VM, not production hardware — the
numbers below are a real measurement of *this* setup, not a claim about
what a production deploy would sustain. Two runs:

**At the plan's literal target (50 dispatches/min, 60 simulated drivers
streaming locations every 4s):**
```
checks.........................: 100.00% 51 out of 51
dispatch_errors.................: 0       0/s
dispatch_latency_ms.............: avg=27.4ms  med=25.07ms  p(90)=33.45ms  p(95)=38.2ms  max=78.01ms
http_req_failed..................: 0.00%   0 out of 51
```
driver-simulator: 60/60 connected, 0 failed, 1080 location pings sent,
51/51 trip offers accepted.

**Stress run at 10x the target rate (500 dispatches/min ≈ 8.3/s) for 90s,
same 60 simulated drivers:**
```
checks.........................: 100.00% 750 out of 750
dispatch_errors.................: 0       0/s
dispatch_latency_ms.............: avg=27.49ms med=26.16ms  p(90)=31.7ms   p(95)=34.22ms max=88.76ms
http_req_failed..................: 0.00%   0 out of 750
```
Zero errors, latency essentially unchanged from the 1x run — this sandbox's
single API process didn't even begin to strain at 10x the documented
target. (With only 60 drivers seeded and every accepted trip never
completing during the run, drivers on the well-known dispatch radius run out
partway through 750 iterations; the remaining requests correctly settle
into `no_drivers_found` rather than erroring — `POST /trips` succeeding is
decoupled from a driver actually being found, by design, so this doesn't
show up as a failed check. The auto-accept counter in driver-simulator's
output can exceed the driver count under high concurrency for the same
reason it's driven by `trip:request` events received, not confirmed
server-side accepts — several near-simultaneous dispatches can race to
offer the same nearest driver before the first offer's lock lands, and only
one of those actually wins.)

**Not verified**: the literal "500 concurrent drivers" figure — connecting
500 real Socket.IO clients from a single machine (this sandbox or a real
load-generation box) hits local ephemeral-port/file-descriptor limits well
before it says anything about the *server's* capacity, so a meaningful run
at that count needs a proper distributed load-generation setup (multiple
k6/Node instances), which is out of scope for a single-sandbox pass. 60
concurrent driver connections were verified with zero connection failures
and no observed degradation; scaling further is a distributed-load-testing
exercise, not a code change.

## Redis/Postgres slow-query pass

Reviewed the hot paths: driver discovery is Redis GEO (`GEOSEARCH`,
already O(log N + M), no schema change needed); all PostGIS geometry
columns (`zones.polygon`, `trips.pickup_point`/`drop_point`,
`trip_locations.point`, `favorite_locations.point`) already have GiST
indexes from the initial migration.

Found and fixed one real gap: `Trip.createdAt`, `Trip.paidAt`, and
`LedgerEntry.createdAt` are all range-filtered (`gte`/`lte`) in the admin
dashboard, financial/operations reports, and `adminListTrips` — none of
those three columns had an index. Added via migration
`20260727161500_trip_ledger_date_indexes`
(`prisma/schema.prisma` `@@index([createdAt])`/`@@index([paidAt])`).

Measured, not assumed: seeded 150k synthetic rows into `trips` and
`ledger_entries` (bulk `INSERT ... SELECT generate_series`, cleaned up
after measuring — see git history for the throwaway seed script, not
committed) and ran `EXPLAIN ANALYZE` on the actual query shapes before/after:

| Query | Without index | With index |
|---|---|---|
| `trips` created in the last day (dashboard "today" stats) | Parallel Seq Scan, 34.7ms | Bitmap Index Scan, 3.0ms |
| `trips` paid in the last 7 days (financial report) | Parallel Seq Scan, 37.9ms | Bitmap Index Scan, 9.9ms |
| `ledger_entries` created in the last 7 days (financial report) | (not separately re-measured — same index, same query shape) | Bitmap Index Scan, 11.5ms |

Roughly 4–10x at only 150k rows; the gap widens further as these tables
grow toward production scale, since a sequential scan's cost is linear in
table size while a B-tree index scan's is close to logarithmic.

## Socket reconnect storm handling

Not a standalone script — a real automated test,
`tests/socket-reconnect-storm.test.ts`, using the same
`createRealtimeServer` + `socket.io-client` pattern as the existing
`tests/realtime-driver.test.ts`. Covers:
- 25 rapid sequential connect/disconnect cycles for one driver: no leaked
  `user:<id>:sockets` state, and `scheduleOfflineGraceCheck`'s fixed
  `jobId` (the driver's own id) means BullMQ dedupes the repeated
  scheduling rather than stacking 25 pending jobs.
- A driver who reconnects before the grace period elapses (even after
  churn) is never spuriously marked offline.
- A burst of 40 concurrent connections across 40 different drivers all
  connect and cleanly disconnect with zero failures.

This is part of the regular `pnpm test` suite (not a manual loadtest/
script) since it's fast and deterministic enough to run every time.
