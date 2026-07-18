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
Update this line as you progress: **Phase 1 — Core Ride Loop (1.3 driver availability + live location done, next: 1.4 trip creation + dispatch engine)**
