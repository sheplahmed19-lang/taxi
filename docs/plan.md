# Ride-Hailing Platform — Full Implementation Plan for Claude Code

**Stack:** Flutter (Rider + Driver apps) · Express + TypeScript (API) · PostgreSQL + PostGIS · Redis · Socket.IO · React + TypeScript (Admin/Company/Dispatcher panels) · Firebase Cloud Messaging

**How to use this document:**
1. Create the monorepo skeleton (Section 2).
2. Save Section 3 as `CLAUDE.md` in the repo root — Claude Code reads it automatically every session.
3. Work through the phases in Section 5 **in order**. Each phase contains numbered tasks written as prompts you can paste directly into Claude Code.
4. Never skip a milestone check — each phase ends with acceptance criteria.

---

## 1. Ground Rules for the Build

- **Build order is sacred:** Backend core → Rider app core → Driver app core → complete one cash ride end-to-end → only then money layer → growth features → admin panels → hardening.
- **One Claude Code session per task.** Keep tasks small (one module, one screen-group, one endpoint-group). Commit after every task.
- **Do NOT build all 16 payment gateways up front.** Ship with Cash + Wallet + 2 gateways (recommend Stripe + Paystack, or swap for your launch market). The `PaymentGateway` adapter interface makes each additional gateway a 2–4 day add-on later.
- **All money logic is double-entry ledger + DB transactions.** No exceptions.
- **All trip state transitions are server-side only.** Apps request transitions; server validates.
- **Every fare/commission parameter lives in the `system_config` table**, never hardcoded.

---

## 2. Monorepo Structure

```
ride-platform/
├── CLAUDE.md                  # Section 3 of this doc
├── docker-compose.yml         # postgres+postgis, redis, api, workers
├── package.json               # pnpm workspaces: apps/api, apps/web
├── apps/
│   ├── api/                   # Express + TypeScript
│   │   ├── src/
│   │   │   ├── config/        # env, constants
│   │   │   ├── db/            # migrations, seeds, prisma or knex
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── drivers/
│   │   │   │   ├── vehicles/
│   │   │   │   ├── zones/          # geofences + zone fares
│   │   │   │   ├── trips/          # trip lifecycle + state machine
│   │   │   │   ├── dispatch/       # matching engine
│   │   │   │   ├── fares/          # pure fare engine
│   │   │   │   ├── wallet/         # double-entry ledger
│   │   │   │   ├── payments/       # gateway adapters + webhooks
│   │   │   │   ├── payouts/
│   │   │   │   ├── promos/
│   │   │   │   ├── referrals/
│   │   │   │   ├── ratings/
│   │   │   │   ├── scheduled/      # scheduled rides
│   │   │   │   ├── chat/
│   │   │   │   ├── notifications/  # FCM + broadcasts
│   │   │   │   ├── reports/        # stats, statements, heat map data
│   │   │   │   └── admin/          # RBAC, staff, config
│   │   │   ├── realtime/       # Socket.IO server, rooms, event handlers
│   │   │   ├── jobs/           # BullMQ queues + workers
│   │   │   ├── middleware/     # auth, rbac, validation (zod), rate limit
│   │   │   └── shared/         # errors, logger, geo utils, money utils
│   │   └── tests/              # vitest — fare engine & ledger MUST be tested
│   └── web/                    # React + Vite + TS + Ant Design
│       └── src/
│           ├── panels/admin/
│           ├── panels/company/
│           ├── panels/dispatcher/
│           ├── panels/rider/      # rider web panel (thin, later phase)
│           ├── panels/driver/     # driver web panel (thin, later phase)
│           └── shared/            # api client, auth, maps, charts
├── mobile/
│   ├── rider_app/              # Flutter
│   └── driver_app/             # Flutter
│       └── (both follow the structure in Section 6)
└── docs/
    ├── api-contract.md         # generated/maintained OpenAPI summary
    └── socket-events.md        # Section 8 of this doc
```

---

## 3. CLAUDE.md

See `/CLAUDE.md` at repo root — kept in sync with this section.

---

## 4. Data Model (create in Phase 0, extend per phase)

Core tables (Postgres + PostGIS):

| Table | Key columns / notes |
|---|---|
| `users` | id, phone (unique), email, name, avatar, role enum(rider,driver,staff,admin,fleet_owner,dispatcher), status, referral_code, referred_by |
| `driver_profiles` | user_id FK, verification_status enum, documents JSONB, earning_mode enum(commission,subscription), vehicle_id, fleet_owner_id, rating_avg, online bool |
| `vehicles` | id, driver_id, fleet_owner_id, vehicle_type_id, plate, model, color, year, documents JSONB |
| `vehicle_types` | id, name, icon, seats, base_fare, per_km, per_min, min_fare, night_multiplier, night_start, night_end, peak_rules JSONB, active |
| `zones` | id, name, polygon GEOMETRY(Polygon,4326), fare_overrides JSONB, active — GiST index |
| `trips` | id, rider_id, driver_id, vehicle_type_id, status enum, pickup/drop point GEOMETRY + address, otp char(4), scheduled_at, distance_m, duration_s, fare_breakdown JSONB, fare_total int, payment_method, payment_status, promo_id, cancelled_by, cancel_reason, timestamps per status |
| `trip_locations` | trip_id, point GEOMETRY, speed, heading, recorded_at (batch-inserted) |
| `wallets` | id, user_id, balance int (derived cache), currency |
| `ledger_entries` | id, wallet_id, trip_id?, type enum(topup,ride_payment,ride_earning,commission,owe,payout,refund,promo_credit,referral_bonus,subscription_fee), debit int, credit int, balance_after int, meta JSONB, created_at — append-only |
| `payments` | id, user_id, trip_id?, gateway, gateway_ref, amount, status, raw_webhook JSONB |
| `payouts` | id, driver_id, amount, status enum(requested,approved,paid,rejected), method, processed_by |
| `owe_amounts` | driver_id, amount, threshold blocking handled in dispatch |
| `subscriptions` | driver_id, plan_id, starts_at, ends_at, status; `subscription_plans` (price, period) |
| `promo_codes` | code, type(flat,percent), value, max_discount, usage_limit, per_user_limit, valid window, min_fare, vehicle_type_ids, zone_ids; `promo_redemptions` |
| `referrals` | referrer_id, referee_id, side enum(rider,driver), bonus_status |
| `ratings` | trip_id, rater_id, ratee_id, stars, review |
| `favorite_locations` | user_id, label, point, address |
| `scheduled_rides` | rider request stored pre-dispatch; job enqueued at T-15min |
| `chat_messages` | trip_id, sender_id, body, read_at |
| `notifications` | user_id, title, body, data JSONB, read_at |
| `system_config` | key, value JSONB (dispatch_radius_km, dispatch_timeout_s, otp_length, commission_pct, cancellation_fee, owe_block_threshold, etc.) |
| `staff_roles` / `permissions` / `role_permissions` | RBAC for panels |

**Trip status enum:** `requested → searching → accepted → arrived → started → completed → paid`, branches: `cancelled_by_rider`, `cancelled_by_driver`, `no_drivers_found`, `expired`, `scheduled`.

---

## 5. Phase-by-Phase Build Plan (Claude Code task prompts)

Each numbered item below is written so you can paste it into Claude Code as-is. Prefix each session with: *"Read CLAUDE.md and docs/socket-events.md first."*

### Phase 0 — Foundations (Week 1–3)

**0.1 — Scaffold monorepo**
> Create a pnpm-workspaces monorepo per the structure in docs/plan.md Section 2. Set up apps/api with Express + TypeScript strict, zod, pino logger, error middleware, /api/v1 router, health endpoint. Add docker-compose.yml with postgres:16-postgis and redis:7. Add ESLint + Prettier + vitest. Add GitHub Actions workflow: lint + test on PR.

**0.2 — Database layer**
> Set up Prisma (or Knex) against Postgres. Create migrations for ALL tables in Section 4 of docs/plan.md, including PostGIS geometry columns (use raw SQL migrations for geometry + GiST indexes). Add seed script: 1 admin, 3 vehicle types (Economy, Comfort, XL), default system_config values, 1 test zone polygon.

**0.3 — Auth module**
> Implement phone-OTP auth: POST /auth/otp/request (rate-limited, OTP stored in Redis 5-min TTL, log OTP to console in dev instead of SMS), POST /auth/otp/verify → issue JWT access (15m) + refresh (30d, rotated, stored hashed). Add role-based auth middleware and requireRole/requirePermission helpers. Email+password login for staff/admin. Tests for token rotation and OTP expiry.

**0.4 — Users & profiles**
> CRUD for rider profile (name, email, avatar upload to S3-compatible storage — use local MinIO in docker-compose for dev). Driver in-app registration flow: submit personal info + vehicle info + document uploads → verification_status=pending. Admin endpoints to list/approve/reject drivers with rejection reason.

**0.5 — Realtime + notifications skeleton**
> Set up Socket.IO with JWT handshake auth. Implement room conventions from docs/socket-events.md (user:{id}, trip:{id}, dispatch:admin). Map socket↔user in Redis. Set up FCM admin SDK and a notifications module with sendToUser(userId, notification) that does FCM push + DB insert + socket emit. BullMQ setup with one demo queue.

**0.6 — Flutter app scaffolds**
> Create mobile/rider_app and mobile/driver_app Flutter projects. Shared setup in each: riverpod, dio with auth interceptor + refresh flow, freezed, go_router, google_maps_flutter, geolocator, socket_io_client, firebase_messaging, flutter_dotenv. Feature-first structure (Section 6). Build: splash → onboarding screens → phone OTP login → profile completion. Theme + design tokens file.

✅ **Phase 0 acceptance:** `docker compose up` + API dev runs; both Flutter apps log in via OTP against local API; driver registration reaches "pending" and admin API can approve it.

### Phase 1 — Core Ride Loop (Week 4–11) ← the heart of the product

**1.1 — Fare engine**
> Implement fares/engine.ts as a pure function: input (vehicleType, zoneOverrides, distanceM, durationS, timestamp, surgeMultiplier=1, promo=null) → itemized breakdown {base, distanceFare, timeFare, nightOrPeakMultiplier, surge, promoDiscount, total, currency}. Night window and peak_rules come from vehicle_types/zone. Full vitest suite covering day/night boundary, min_fare floor, peak windows, promo caps.

**1.2 — Fare estimate endpoint**
> POST /api/v1/fares/estimate {pickup, drop, vehicleTypeId?}: resolve zone via PostGIS ST_Contains, get route distance/duration from Google Directions API (wrap in shared/maps.ts with caching), return estimates for all active vehicle types. Handle no-route errors.

**1.3 — Driver availability + live location**
> Driver endpoints/socket: availability toggle (online/offline — blocked if unverified or owe > threshold); socket event driver:location every 3–5s → write Redis GEOADD drivers:online:{vehicleTypeId} and hash driver:{id}:state. On disconnect, 60s grace then mark offline. GET /drivers/nearby for rider app map (returns anonymized nearby car positions).

**1.4 — Trip creation + dispatch engine**
> POST /trips: validate rider has no active trip, create trip (status=requested, generate 4-digit OTP, snapshot fare estimate), then dispatch: Redis GEOSEARCH for online idle drivers of the vehicle type within dispatch_radius_km → rank by distance → offer to driver #1 via socket trip:request + FCM with dispatch_timeout_s TTL (BullMQ delayed job) → on reject/timeout cascade to next → expand radius once → else status=no_drivers_found. Redis lock per driver prevents double offers. All transitions via state machine.

**1.5 — Trip lifecycle**
> Implement accept/arrive/start/complete/cancel: driver accept (first-accept-wins with lock) → status=accepted, notify rider with driver+vehicle+ETA; driver arrived → notify rider; start requires OTP match; during trip driver locations relay to trip room + batch-insert trip_locations; complete → compute actual distance (sum haversine over pings, fallback to Directions), run fare engine for final fare, store breakdown. Cancellations both sides with reason + cancellation_fee rules from config. Rating endpoints post-trip.

**1.6 — Rider app: full ride flow**
> Home map screen with current location + nearby cars; pickup/drop selection with Google Places autocomplete + map-pin drag; vehicle type carousel with per-type fare estimates; request ride → searching UI → driver assigned card (photo, plate, rating, call button via url_launcher tel:) → live driver marker animation → OTP display → on-trip screen with route polyline → trip complete → fare breakdown → rate & review → ride history screens.

**1.7 — Driver app: full ride flow**
> Online/offline toggle with foreground location service (background geolocation, battery-sane 4s interval); incoming trip request full-screen with timer, fare estimate, pickup distance, accept/reject; navigate-to-pickup with in-app map + "Open in Google Maps" deep link; arrived button → OTP entry → on-trip with realtime distance/duration display → complete trip → fare summary (cash: "collect X") → earnings today widget → ride history → rate rider.

**1.8 — Cash payment close-out**
> On completed cash trip: mark payment_status=paid(cash), post ledger entries: driver earning credit + commission debit → owe_amounts increment (driver owes commission on cash rides). Owe threshold check in availability toggle.

✅ **Phase 1 acceptance (THE milestone):** with two phones on the staging API — rider requests, driver accepts, OTP starts trip, live tracking works both directions, trip completes with correct fare, cash settles, both rate each other. Do not proceed until this works reliably.

### Phase 2 — Money Layer (Week 12–17)

**2.1 — Wallet + ledger hardening**
> Finish wallet module: postEntry() double-entry with SELECT...FOR UPDATE, balance_after integrity check, idempotency keys on all money endpoints. Transaction history endpoint with cursor pagination. Vitest: concurrent-topup race test, negative-balance rejection.

**2.2 — Payment gateway abstraction + Stripe**
> payments/gateway.interface.ts {createIntent, capture, verifyWebhook, refund}. Implement Stripe adapter: wallet top-up flow and pay-ride-by-card flow (PaymentSheet in Flutter via flutter_stripe). Webhook endpoint with signature verification, idempotent processing, ledger posting.

**2.3 — Second gateway (Paystack or market pick) + wallet payment**
> Paystack adapter (init transaction + webhook verify). Ride payment method selector in rider app: cash / wallet / card. Wallet payment: atomic debit at trip completion, insufficient-balance fallback to cash with notification.

**2.4 — Commission & subscription settlement**
> Settlement service at trip completion: commission mode → platform takes commission_pct (per vehicle type override-able); subscription mode → driver keeps 100% while subscription active. Subscription plans CRUD, driver purchase via wallet/gateway, expiry job that flips drivers back to commission and notifies.

**2.5 — Payouts + owe management**
> Driver payout request → admin approve/reject → mark paid (manual transfer v1) with ledger entries. Owe amount view for drivers, "pay owe from wallet" action. Admin owe report + manual adjust with audit log. Weekly driver statement generation (BullMQ cron) as PDF/CSV.

✅ **Phase 2 acceptance:** top-up via Stripe test mode reflects in wallet; wallet-paid and card-paid rides settle correctly; commission vs subscription drivers settle differently; payout lifecycle works; ledger sums to zero across the platform.

### Phase 3 — Growth Features (Week 18–22)

**3.1 — Promo codes**: full CRUD + validation service (limits, windows, zones, vehicle types, min fare) + apply-at-estimate and lock-at-completion + redemption tracking + rider app promo entry UI.
**3.2 — Referrals**: rider & driver referral codes, share sheet in apps, bonus rules in config (e.g., credit both after referee's first completed trip — BullMQ job on trip completion), referral dashboards in apps.
**3.3 — Scheduled rides**: rider picks datetime → scheduled_rides row + BullMQ delayed job at T-15min enters normal dispatch; reminder pushes at T-60/T-15; cancel/edit; driver app upcoming-scheduled list.
**3.4 — Favorite locations + share tracking**: saved places (Home/Work/custom) wired into pickup/drop pickers; share-ride: tokenized public URL → minimal React page showing live trip map via public socket namespace (read-only, token-scoped).
**3.5 — In-trip chat + calling**: chat_messages over trip room socket + FCM when backgrounded, chat UI both apps, unread badges; call buttons (plain tel: v1; note Twilio masked-proxy as v2 upgrade).
**3.6 — Notifications center**: in-app notification list screens, admin broadcast endpoint (segment: all riders / all drivers / zone) fan-out via BullMQ.

✅ **Phase 3 acceptance:** promo applies and caps correctly; referral bonus lands after first trip; scheduled ride fires and dispatches on time; share link shows live trip to a logged-out browser; chat delivers in background.

### Phase 4 — Panels & Analytics (Week 23–27)

**4.1 — Web scaffold + RBAC**: React+Vite+AntD app, login, permission-driven routing/menus for admin/company/dispatcher panels, shared API client + table/query components.
**4.2 — Admin core**: dashboards (trips/day, revenue, active drivers, completion rate — Recharts), driver verification queue with document viewer, users/staff/fleet-owner management, vehicle & vehicle-type management, system configuration editor, roles & permissions UI.
**4.3 — Live ops**: realtime map (all online drivers + active trips via admin socket namespace, marker clustering), trip detail with route replay from trip_locations, heat map layer (demand: trip request origin density; supply: driver density) with time filters.
**4.4 — Dispatcher/company panel**: manual booking form (create trip for a phone number, assign nearest or chosen driver), trip management (view/cancel/reassign), payouts approval queue, owe management, statements, financial & operations reports with CSV export, message broadcast composer, geofence/zone polygon editor on map with fare overrides.
**4.5 — Rider & driver web panels (thin)**: web login, ride history, receipts, wallet/transactions, profile — reuse API, minimal scope.

✅ **Phase 4 acceptance:** dispatcher creates a manual booking that a real driver app receives; admin watches it live on the map; finance exports match ledger totals; zone editor changes affect fare estimates immediately.

### Phase 5 — Hardening & Launch (Week 28–31)

**5.1 — Load & chaos**: k6 socket + dispatch load test (target: 500 concurrent drivers streaming locations, 50 dispatches/min on a single node), Redis/Postgres slow-query pass, socket reconnect storm handling.
**5.2 — Security pass**: rate limits everywhere, webhook replay protection, RBAC audit, OTP brute-force lockout, GPS-spoof mitigations (mock-location detection in driver app, server-side speed sanity checks), dependency audit, secrets review.
**5.3 — Observability**: Sentry (API + both Flutter apps + web), structured logs shipped, uptime checks, ledger-integrity nightly job (sum of entries = 0), alerting on dispatch failures.
**5.4 — Release**: production docker deploy (VPS + Nginx + TLS), Play Store listing + signed AAB for both apps, iOS TestFlight if applicable, staged rollout, driver onboarding ops checklist, support runbook.

---

## 6. Flutter App Structure (both apps)

```
lib/
├── main.dart
├── app/            # router, theme, DI (riverpod providers)
├── core/
│   ├── api/        # dio client, interceptors, error mapping
│   ├── socket/     # socket service, event typedefs
│   ├── location/   # geolocator wrapper, permissions, bg service (driver)
│   ├── maps/       # map utils, marker animation, polyline decode
│   ├── push/       # FCM setup, local notifications
│   └── storage/    # secure storage (tokens), prefs
├── features/
│   ├── auth/  onboarding/  profile/  home_map/  booking/   (rider)
│   ├── trip/  wallet/  history/  promos/  referrals/  chat/ ...
│   └── (driver: availability/ requests/ earnings/ navigation/ ...)
└── shared/         # widgets, freezed models (mirror API DTOs), formatters
```

Key packages: `flutter_riverpod`, `dio`, `freezed`+`json_serializable`, `go_router`, `google_maps_flutter`, `geolocator`, `flutter_polyline_points`, `socket_io_client`, `firebase_messaging`+`flutter_local_notifications`, `flutter_secure_storage`, `url_launcher`, `flutter_stripe` (rider), `share_plus`, driver bg location: `flutter_background_service` or `background_locator_2`.

---

## 7. API Surface Summary (v1)

See `docs/api-contract.md`.

## 8. Socket.IO Event Contract

See `docs/socket-events.md`.

---

## 9. Environment & Services Checklist
- Google Maps Platform key (Maps SDK Android/iOS, Directions, Distance Matrix, Places, Geocoding) — set billing caps and per-key restrictions
- Firebase project ×2 apps (FCM, crashlytics optional)
- Stripe + Paystack test accounts; webhook tunneling in dev (stripe cli / ngrok)
- SMS provider for OTP (Twilio or local Egyptian gateway) — console-log OTP in dev
- S3-compatible bucket (MinIO dev / any provider prod)
- Sentry project ×4 (api, web, rider, driver)
- Domains + TLS; separate staging environment from week 4 onward

## 10. Timeline & Effort Summary

| Phase | Weeks | Outcome |
|---|---|---|
| 0 Foundations | 1–3 | Auth, DB, scaffolds, realtime skeleton |
| 1 Core ride loop | 4–11 | Complete cash ride end-to-end |
| 2 Money layer | 12–17 | Wallet, 2 gateways, settlement, payouts |
| 3 Growth | 18–22 | Promos, referrals, scheduled, chat, sharing |
| 4 Panels | 23–27 | Admin/company/dispatcher + analytics + heat maps |
| 5 Hardening | 28–31 | Load, security, observability, store launch |
