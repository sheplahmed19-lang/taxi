# Security notes

Living document for security-relevant decisions and known gaps. Updated as
part of Phase 5.2 ("Security pass") and expected to keep growing through
Phase 5.4 (Release) and beyond.

## Rate limiting

- Global: 600 requests / 5 min per IP, applied to the entire `/api/v1` surface
  (`middleware/rateLimit.ts:globalRateLimit`, mounted in `app.ts`).
- Auth-specific: 20 requests / min per IP on everything under `/auth`
  (`authRateLimit`) — defense in depth alongside `auth/otp.ts`'s own
  phone-keyed limiter (3 OTP requests/min per phone), which does nothing
  against an attacker rotating through many phone numbers from one IP.
- Both are backed by Redis (`rate-limit-redis`), not in-process memory, so
  the limit holds even if the API scales to multiple processes/nodes.
- OTP verify brute-force lockout: `auth/otp.ts:verifyOtp` now tracks
  attempts per phone (`otp:verify_attempts:<phone>`, 15-min window) and
  locks out after 5 wrong guesses — previously unlimited, and a short
  numeric OTP (`otp_length` config, default 4 digits) has few enough
  possibilities to be brute-forceable within its 5-minute TTL otherwise.

## Webhook security (Stripe / Paystack)

- Signature verification: Stripe via `stripe.webhooks.constructEvent`
  (includes its own timestamp-tolerance check); Paystack via manual
  HMAC-SHA512, now compared with `crypto.timingSafeEqual` (was a plain
  `!==` string compare — a theoretical timing side-channel, fixed even
  though a webhook secret is not attacker-guessable byte-by-byte over the
  network in practice).
- Replay/duplicate-delivery protection: `payments/service.ts:handleWebhook`
  now dedupes by event id (`webhook:processed:<gateway>:<eventId>`, Redis
  `SET NX`, 24h TTL) *before* touching the database. This sits alongside,
  not instead of, the pre-existing `payment.status !== "pending"` guard —
  that one is the permanent backstop (a payment can only ever leave
  `pending` once, with no TTL), the new one is a fast, time-boxed
  short-circuit. Paystack's HMAC signature carries no timestamp at all
  (unlike Stripe's, which `constructEvent` already checks), so a captured
  valid (signature, body) pair has no built-in expiry on that gateway —
  disclosed limitation: the dedupe key's 24h TTL, not a cryptographic
  timestamp, is what bounds the replay window there.

## GPS-spoof mitigations

- Server-side speed sanity check: `drivers/service.ts:recordLocation`
  compares a new ping against the driver's last recorded position/time and
  rejects it outright if the implied speed exceeds `max_plausible_speed_kmh`
  (system_config, default 180 km/h, CLAUDE.md rule 10 — never hardcoded).
  Skipped when less than 2s has elapsed since the last ping, so ordinary GPS
  jitter over a tiny interval can't false-positive. This only covers the
  live Redis GEO position (used for dispatch + the admin live map); the
  separately-buffered `trip_locations` route-replay path
  (`trips/service.ts:relayAndRecordTripLocation`) does not yet share this
  check — a disclosed scope decision, not an oversight, since that path
  only affects trip-detail route replay, not driver discovery/dispatch.
- Mock-location flagging: the driver app now reads geolocator's
  `Position.isMocked` (Android's mock-location-provider flag; always false
  on iOS) and sends it alongside each `driver:location` ping. The server
  logs a warning (not a hard block — disabling a flagged account is a
  policy/ops call, and legitimate testing/dev also sets this flag) so it's
  visible for review rather than silently ignored.

## RBAC

- Route-level gating (`requireAuth`/`requireRole`) was audited across every
  router in `apps/api/src/modules/*/routes.ts`; every route has an explicit
  guard. Two modules (`notifications`, `ratings`) have zero registered
  routes at all — intentional stubs, not a gap: their real functionality
  already lives elsewhere (`GET /users/me/notifications`, `POST
  /trips/:id/rate`), both already gated by their own router's `requireAuth`.
- Previously, the `admin`/`dispatcher`/`fleet_owner` route-boundary split
  from Phase 4.4 had only ever been checked manually against a running dev
  server (curl), never by an automated test. `tests/rbac-http.test.ts` now
  exercises the actual Express middleware chain over real HTTP (via
  `supertest`, this repo's first HTTP-level test file) for the boundaries
  that matter most: unauthenticated → 401; wrong role → 403; a dispatcher
  reaching `OPS_ROLES` routes but not `STAFF_ONLY` ones; a `fleet_owner`
  reaching only `/admin/my-fleet`.
- `requirePermission()` (the fine-grained `StaffRole`/`Permission`/
  `RolePermission` mechanism) remains unwired into any route — an explicit,
  disclosed scope decision from Phase 4.2, unchanged by this pass. Route
  gating today is role-based (`requireRole`), not permission-based.

## Secrets

- `.env`/`.env.*` are gitignored (`!.env.example` is the only tracked
  exception); no `.env` files or obvious hardcoded credentials (API keys,
  private key blocks) are present in tracked source.
- `config/env.ts` previously defaulted `JWT_ACCESS_SECRET`/
  `JWT_REFRESH_SECRET` to fixed, committed-in-this-repo dev values with no
  guard — a production deploy that forgot to set them would have silently
  booted with a publicly-known, forgeable JWT signing secret. Now: in
  `NODE_ENV=production`, the app refuses to start unless both secrets are
  at least 32 characters. A minimum-length check rather than a blocklist of
  known-bad values on purpose — it also catches equally-weak placeholders
  like `change-me` (this sandbox's own `.env` uses exactly that), not just
  the schema's literal defaults. Verified via `tests/env-secrets-guard.test.ts`,
  which runs the check in real subprocesses (a module-load-time guard can't
  be exercised any other way without touching the shared test-process
  module cache).

## Known, disclosed gaps (not fixed this pass)

- **Dependency audit** (`pnpm audit --prod`): 4 moderate-severity advisories.
  `uuid` (<11.1.1, buffer-bounds-check issue) is a transitive dependency
  three levels deep inside `firebase-admin`'s Google Cloud client libraries
  — not reachable without a `firebase-admin` major-version bump. Three
  `react-router`/`react-router-dom` advisories (open redirect, SSR-hydration
  constructor injection) are only patched on the v7 line; apps/web is
  deliberately pinned to v6 for React 18 compatibility (same reasoning as
  the `react-leaflet` v4 pin from Phase 4.3). The SSR-hydration advisory
  doesn't apply here at all (apps/web is a client-only Vite SPA, no SSR);
  the open-redirect one requires user-controlled navigation targets, which
  this codebase's `<Link>`/`useNavigate` calls never take (always hardcoded
  internal paths). Both are moderate severity with low actual exploitability
  here — deferred pending a dedicated react-router v7 migration (a breaking
  API change deserving its own pass, not a security hotfix).
- **`requirePermission()` enforcement** — see RBAC section above.
- **Load & chaos, observability, release hardening** — Phase 5.1/5.3/5.4,
  tracked separately.
