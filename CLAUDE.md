# Ride-Hailing Platform — Project Instructions

## What this is
Uber-style ride-hailing platform: Flutter rider & driver apps, Express+TS API,
Postgres+PostGIS, Redis, Socket.IO realtime, React admin panels, FCM push.

## Commands
- API dev:        pnpm --filter api dev
- API tests:      pnpm --filter api test
- Migrations:     pnpm --filter api migrate:dev / migrate:deploy
- Web dev:        pnpm --filter web dev
- Rider app:      cd mobile/rider_app && flutter run
- Driver app:     cd mobile/driver_app && flutter run
- Full stack:     docker compose up -d (postgres, redis) then API dev
- Lint all:       pnpm lint && (cd mobile/rider_app && flutter analyze)

## Architecture rules (do not violate)
1. Modular monolith. Modules under apps/api/src/modules/. A module exposes
   routes + service; other modules import only its service, never its internals.
2. Trip state machine transitions happen ONLY in trips/service via
   transitionTrip(tripId, event). Valid transitions are defined in
   trips/state-machine.ts. Apps never set status directly.
3. ALL wallet/balance changes go through wallet/ledger.ts postEntry() inside a
   DB transaction with row locks. Never UPDATE a balance column directly.
4. Fare calculation is the pure function in fares/engine.ts. It returns an
   itemized breakdown; the full breakdown JSON is stored on the trip.
5. Payment providers implement the PaymentGateway interface in
   payments/gateway.interface.ts. Webhooks must be signature-verified.
6. Geo queries use PostGIS (zones, geofences) and Redis GEO (live driver
   positions). Driver live location is NEVER read from Postgres.
7. All request bodies validated with zod schemas colocated in each module.
8. API is versioned under /api/v1. Responses: { success, data | error }.
9. Socket.IO events and payloads are defined in docs/socket-events.md.
   Update that file whenever an event changes.
10. Config values (fares, commission %, dispatch radius, OTP length, timeouts)
    are read from system_config table via config service — never hardcoded.

## Code style
- TypeScript strict mode everywhere. No `any` in money or trip code.
- Money stored as integer minor units (piastres/cents). Use shared/money.ts.
- Flutter: riverpod for state, dio for HTTP, socket_io_client for realtime,
  freezed models mirroring API DTOs. Feature-first folder structure.
- Tests required for: fares/engine.ts, wallet/ledger.ts, trips/state-machine.ts,
  dispatch ranking logic, promo validation.

## Current phase
Update this line as you progress: **Phase 1 done (1.1–1.8; the acceptance milestone itself needs a real device/emulator with two phones, unavailable in this sandbox). Phase 2 — Money Layer — done in full (2.1–2.5): wallet/ledger hardening; Stripe + Paystack gateways; wallet ride-payment with insufficient-balance cash fallback; per-vehicle-type commission override + subscription mode (100% earnings while active, wallet/gateway purchase, supersede-not-stack, BullMQ expiry job); and 2.5 — payouts (request reserves the amount out of the wallet immediately via postEntry, not at approval time, so nothing lets a driver over-request against pending payouts; approve/reject/mark-paid workflow, reject refunds the reservation) + owe management (driver "pay owe from wallet" self-service, admin report + manual delta adjustment, both new admin actions logged to a new AuditLog model) + weekly driver CSV statements (BullMQ Monday-00:00 cron, `jobs/weeklyStatements.ts`; upload step is injectable so the aggregation logic is fully tested without a real S3 endpoint — no MinIO running in this sandbox, so the upload itself is unverified end-to-end, same disclosed category as GOOGLE_MAPS_API_KEY/STRIPE_SECRET_KEY). Also fixed a second instance of the same migration hazard from 2.4: `prisma migrate dev` went non-interactive-refusal on this migration, so the SQL was generated via `prisma migrate diff`, hand-stripped of the same spurious GiST-index DROP statements, applied directly, and registered via `prisma migrate resolve --applied`; verified via a from-scratch `migrate deploy` that all 9 migrations apply cleanly with the indexes intact. Phase 3 — Growth Features — 3.1 promo codes done (backend; no schema migration needed, PromoCode/PromoRedemption/Trip.promoId already existed from Phase 0's schema): `promos/service.ts` centralizes eligibility (active window, min fare, vehicle-type/zone allow-lists, overall + per-user usage limits) behind `resolveAndValidatePromo`, reused by both the no-side-effect `POST /promos/validate` preview and the two real attach points — `POST /trips` with an optional `promoCode` (validated against that same request's fare estimate before the trip row is even created) and `POST /promos/apply` for adding a code to an already-requested trip before it starts. A `PromoRedemption` row is written the moment a promo actually attaches to a trip (that's what usage limits count against), and `cancelTrip` deletes it again so a cancelled ride never burns the slot. `fares/engine.ts`'s discount math was extracted into a standalone `applyPromoDiscount` so `completeTrip` can re-apply a trip's already-attached promo's raw terms against the newly-measured final fare — locked in, without re-checking eligibility — matching the "lock-at-completion" plan requirement. Full admin CRUD lives under `/admin/promos` (delete blocked once a promo has redemptions — deactivate instead). Rider-app promo entry UI is deferred (backend-only pass, matching the project's usual backend-then-app cadence within a sub-phase). Next: Phase 3.2 — Referrals.**

## Flutter SDK
No Flutter SDK ships with this environment by default. It was cloned into `/tmp/flutter-sdk`
for this session (`git clone https://github.com/flutter/flutter.git -b stable --depth 1`,
then add `bin/` to PATH) — that clone does not persist across sessions/containers, so repeat
it if `flutter`/`dart` aren't found. No Android SDK, no Chrome, and no Linux desktop GTK libs
are installed, so `flutter analyze` and `flutter test` (widget tests, Dart-VM only) are the
available verification tools — there is no way to actually run either app on a device/emulator
here. Both `mobile/rider_app` and `mobile/driver_app` need `.env` copied from `.env.example`
before `flutter test`/`flutter analyze` will pass asset resolution (gitignored, per-developer).
