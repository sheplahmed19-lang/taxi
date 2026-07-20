# API Surface Summary (v1)

Base path: `/api/v1`. Responses: `{ success, data | error }`.

```
/auth        otp/request, otp/verify (body may include referralCode — only applied on the
             new-account path, silently ignored on a returning login), refresh, staff/login
/users       me, me (PATCH), favorites CRUD, notifications list
/drivers     register, documents, availability, nearby, earnings (not yet implemented),
             statements (list, signed download URL per statement), owe (GET), owe/pay (POST,
             settles the full outstanding amount from the driver's own wallet), scheduled
             (this driver's own accepted/arrived trips that originated as a scheduled ride)
/vehicles    types (list, any authenticated role); admin CRUD lives under /admin
/fares       estimate
/trips       create (body may include promoCode, applied atomically with the fare estimate),
             :id, :id/accept|arrive|start|complete|cancel, :id/rate, history,
             :id/share (POST, participant-only — mints a tokenized tracking link),
             :id/track (GET, public — no auth; query: {token})
/scheduled   create (rider; body: {pickup, drop, vehicleTypeId, paymentMethod, scheduledFor} —
             scheduledFor must be at least system_config's scheduled_dispatch_lead_minutes
             from now), list mine, :id (get), :id (PATCH, edit — only while still pending),
             :id/cancel
/wallet      balance, transactions (cursor pagination), topup/init (body: {amount, currency?, gateway?} —
             gateway is "stripe" (default) or "paystack"); wallet is also a trip paymentMethod, settled
             atomically at trip completion with an automatic fallback to cash on insufficient balance
/payments    ride/:tripId/init (charges a completed card-pay trip's final fare; body: {gateway?}),
             webhook/:gateway (signature-verified, idempotent — :gateway is "stripe" or "paystack",
             each with its own signature header); methods CRUD not yet implemented
/subscriptions plans (list, any authenticated role), me (driver's current subscription),
             purchase (body: {planId, gateway?} — omit gateway to pay from wallet synchronously,
             set it to pay via Stripe/Paystack instead, activated once the webhook confirms).
             A driver on an active subscription keeps 100% of every fare (no commission); an
             expiry job flips them back to commission-based earning and notifies them.
/payouts     request (body: {amount} — reserved out of the wallet immediately, refunded on
             reject), me (list own); admin approve/reject(reason)/paid(method) under /admin
/promos      validate (body: {code, pickup, drop, vehicleTypeId} — no side effects, safe to
             call on every keystroke), apply (body: {tripId, code} — attaches a code to an
             already-created trip before it starts); admin CRUD under /admin/promos
/referrals   my-code (own referral code), stats (totalReferred, pending, credited)
/chat        :tripId/messages (GET list, POST send — REST fallback; chat:send/chat:message
             over the /app socket is the primary path), :tripId/read (POST, marks the other
             participant's messages read)
/admin       dashboard (GET — tripsToday, revenueToday, activeDrivers, completionRate),
             drivers (list, filter by verificationStatus), drivers/:id/approve|reject(reason),
             drivers/:id/documents (GET — signed, time-limited URL per uploaded document),
             users (GET, filter by role/status/search; POST — creates a staff/admin/
             fleet_owner/dispatcher account with email+password, audit-logged),
             users/:id (PATCH — name/email/staffRoleId, audit-logged when staffRoleId changes),
             users/:id/status (POST; body: {status: "active"|"suspended"|"banned"},
             audit-logged), vehicle-types (GET all incl. inactive, POST create),
             vehicle-types/:id (PATCH), vehicles (GET, filter by driverId), vehicles/:id (PATCH),
             config (GET — every system_config row), config/:key (PATCH; body: {value} —
             edits an existing key only, 404s on an unknown one, invalidates the 30s read
             cache immediately), permissions (GET), roles (GET, POST create with
             permissionIds), roles/:id (PATCH — replaces the permission set when
             permissionIds is passed; DELETE — blocked while still assigned to a user),
             live/drivers (GET — every currently-online driver, any vehicle type, with
             identity + live position, for the realtime map), live/trips (GET — every
             non-terminal trip with pickup/drop and the assigned driver's live position),
             trips/:id (GET — full admin trip detail incl. the trip_locations route replay,
             no participant restriction), heatmap/demand (GET; query: {from?, to?} — one
             point per trip pickup in range, ISO date strings, omit either bound for
             unbounded), heatmap/supply (GET — online driver positions; always a live
             snapshot, no time filter, see below),
             zones, manual-booking, reports/* (not yet implemented — Phase 4.4),
             subscriptions/plans (POST), subscriptions/plans/:id (PATCH),
             payouts (list, filter by status), payouts/:id/approve|reject|paid,
             owe (report of drivers with a positive balance), owe/:driverId/adjust
             (body: {delta, reason} — signed delta, clamped at 0, audit-logged),
             broadcasts (POST; body: {title, body, segment: "all_riders"|"all_drivers"|"zone",
             zoneId? — required iff segment is "zone"}, fans out via BullMQ, audit-logged),
             promos (POST create, PATCH :id update, DELETE :id — blocked once redeemed,
             deactivate instead)
```

Promo codes: eligibility (active window, min fare, vehicle type/zone allow-lists, overall
and per-user usage limits) is checked once when a code is attached to a trip — either at
creation (`POST /trips` with `promoCode`) or afterward via `POST /promos/apply`, both before
the trip starts. A `PromoRedemption` row is written at that moment, which is what usage
limits actually count against; cancelling the trip deletes it again, freeing the slot. At
completion, `trips/service.ts:completeTrip` re-applies the *same* promo's raw discount terms
against the newly-measured final fare without re-checking eligibility (`fares/engine.ts`'s
`applyPromoDiscount`) — a promo attached mid-trip stays honored through completion even if
its window elapses or another rider exhausts its usage limit while this trip is in progress.

Referrals: every user gets a unique 8-character referral code at account creation
(`referrals/service.ts:generateReferralCode`). A code passed to `POST /auth/otp/verify`
during signup links the new user to their referrer (`User.referredBy` + a `Referral` row,
`bonusStatus: pending`) — invalid or self-referral codes are silently ignored rather than
blocking signup. The moment either trip participant (rider or driver) settles a trip to
"paid" — `trips/service.ts`'s `completeTrip`/`markTripPaid` — a BullMQ job
(`jobs/referralBonus.ts`) checks whether that specific user has a pending referral and, if
so, credits both referrer and referee (amounts from `system_config`'s `referral_bonus_rider`/
`referral_bonus_driver`, keyed by the referee's role) via the wallet ledger and flips the
referral to `credited`; both wallets are credited before the status flip so a crash mid-job
can never leave a referral marked paid without the money having moved, and postEntry's
idempotency key makes a retried/duplicate job a no-op rather than a double-credit. Rider/
driver app referral share sheet and dashboard UI are deferred (backend-only pass).

Scheduled rides: a ScheduledRide row (pickup/drop coords + address, vehicle type, payment
method, scheduledFor) is created immediately, but the actual Trip is NOT — that only happens
at dispatch time, so a rider can freely book a ride for next week without it counting as
their one "active trip" and blocking an immediate ride today. `jobs/scheduledRides.ts`
schedules two BullMQ delayed jobs per ride at creation (and re-schedules them on every edit):
a reminder push at T-`scheduled_reminder_minutes` and, at T-`scheduled_dispatch_lead_minutes`,
a combined reminder+dispatch job that calls the exact same `dispatch/service.ts:requestTrip`
path an immediate request goes through, then links the resulting `Trip.id` back onto the
`ScheduledRide` row (`status: dispatched`). A rider who happens to have another active trip
right at dispatch time gets a clear "couldn't start your scheduled ride" push instead of the
ride silently vanishing — the row still moves to `dispatched` (meaning "handed off"), just
with `tripId` left null. Cancelling before dispatch just drops the pending jobs; cancelling
after routes through the normal `trips/service.ts:cancelTrip` (so cancellation-fee rules
still apply). Rider/driver app UI (datetime picker, upcoming-scheduled list rendering) is
deferred — this phase is the backend + `GET /drivers/scheduled` endpoint only.

Favorite locations: full CRUD already shipped in Phase 0.4 (`/users/me/favorites`) — no
new backend work this phase. Wiring saved places into the rider app's pickup/drop pickers
is deferred, same app-UI cadence as everything else in this phase.

Share tracking: `POST /trips/:id/share` (participant-only) mints an opaque token stored in
Redis (`shared/shareTokens.ts`, key → tripId, TTL from `system_config`'s
`share_link_ttl_hours`) — deliberately not a Trip column, since it's a short-lived derived
value with nothing to migrate. `GET /trips/:id/track?token=...` is mounted outside the
router's `requireAuth` gate and returns a minimal read-only view (status, pickup/drop
coords+address, driver name, vehicle plate/model/color, vehicle type — no OTP, payment
method, fare, or phone numbers). The `/public` Socket.IO namespace (registered but inert
since Phase 0.5) now authenticates its handshake against `{tripId, token}` instead of a JWT,
joins the same `trip:{id}` room the authenticated `/app` namespace uses, and
`realtime/index.ts:emitToTrip` now broadcasts to both namespaces — so a logged-out tracker
gets the same `trip:status`/`trip:driver_location` events a participant sees, live, for as
long as their token is valid. The minimal public React tracking page itself is deferred,
same backend-then-app cadence as the rest of Phase 3.

In-trip chat: `chat:send` (client→server, `/app` socket) persists a `ChatMessage` row,
relays it live to the trip room as `chat:message`, and separately notifies the *other*
participant through the normal notifications pipeline (`notifications/service.ts:sendToUser`
— DB row + socket + best-effort FCM), which is what actually reaches them if the app is
backgrounded. `POST /chat/:tripId/messages` is a REST fallback for the same send path
(useful for clients without a live socket, or for tests); `GET /chat/:tripId/messages` lists
the full thread chronologically; `POST /chat/:tripId/read` marks the counterparty's messages
read, backing an unread-badge count. Call buttons are a plain `tel:` link in the (deferred)
app UI — no backend surface needed for v1; a Twilio masked-proxy call is noted in the plan
as a v2 upgrade, not built here. Chat UI and unread badges in both apps are deferred, same
backend-then-app cadence as the rest of Phase 3.

Notifications center: the in-app notification list (`GET /users/me/notifications`) has
existed since Phase 0.5; the new piece is `POST /admin/broadcasts`. `all_riders`/
`all_drivers` resolve directly off `User.role`; `zone` resolves to currently-*online*
drivers (any vehicle type) whose live Redis GEO position falls inside the given zone's
polygon (`ST_Contains`, one query per candidate driver — riders have no persistent live
position to filter by, so `zone` only ever targets drivers). Actually sending is handed off
to a new BullMQ job (`jobs/broadcasts.ts`) rather than done inline — a segment can be
thousands of recipients, and the per-recipient FCM call inside `sendToUser` shouldn't block
the admin's HTTP response — and one recipient's delivery failure (e.g. a stale FCM token)
never aborts the rest of the batch. Every broadcast is audit-logged (`shared/auditLog.ts`,
same trail as the payout/owe admin actions) with the resolved recipient count. In-app
notification list *screens* (as opposed to the list endpoint itself, which predates this
phase) are deferred, same backend-then-app cadence as the rest of Phase 3 — this closes out
Phase 3.

Weekly driver statements: a Monday-00:00 BullMQ cron
(`jobs/weeklyStatements.ts:scheduleWeeklyStatementsCron`) generates a CSV per
approved driver (trip count, gross fare, commission, net earning for the
past 7 days) and uploads it via the existing S3-compatible object storage.
Not verifiable end-to-end in this sandbox — no MinIO instance is running
here (see CLAUDE.md's Docker note) — but `generateDriverStatement`'s upload
step is injectable and fully covered by tests without it.

Admin core (Phase 4.2): six backend areas, all requiring zero schema migrations since every
needed table/column (`DriverProfile.documents`, `SystemConfig`, `StaffRole`/`Permission`/
`RolePermission`, `User.staffRoleId`) already existed unused from Phase 0's schema.
`getDashboardStats` buckets today's trips by `Trip.createdAt`, revenue by `Trip.paidAt` +
`paymentStatus: "paid"`, active drivers by `DriverProfile.online`, and completion rate as
`completedToday / tripsToday`. The driver document viewer reuses `shared/storage.ts:
getSignedObjectUrl` (SigV4 presigning is a local computation, no network round-trip, so this
is testable and E2E-verifiable even without a running MinIO — the actual image bytes are the
disclosed-unverified part, same category as GOOGLE_MAPS_API_KEY/STRIPE_SECRET_KEY elsewhere
in this project). Staff/admin/fleet_owner/dispatcher accounts are created with a real phone
number as required input (`User.phone` is unique + required with no default) rather than via
a migration to make it nullable. `setConfigValue` only edits keys the app already reads by
name — it 404s rather than inventing a new tunable nothing consumes — and invalidates that
key's 30s in-memory cache entry so an admin's edit is visible immediately. Roles & permissions
is CRUD only in this phase: it populates `StaffRole`/`Permission`/`RolePermission`, but
`requirePermission()` is not yet wired into any route gate (confirmed zero call sites before
this phase) — wiring inconsistent enforcement across admin routes, or accidentally locking
out an admin-role user with no assigned `StaffRole`, was judged worse than leaving enforcement
role-based (`requireRole("admin", "staff")`) for one more phase. The seed script now also
upserts 8 permissions and a "Super Admin" `StaffRole` with all of them attached, assigned to
the seeded admin user. Frontend: real dashboard data + a Recharts bar chart (trips today vs.
active drivers — revenue and completion rate stay as `Statistic` cards since their units don't
compare on the same axis), a driver verification queue with approve/reject and a document
viewer modal, a users page (filters, create-staff modal, edit, suspend/reactivate), a vehicles
page (vehicle-type and vehicle tabs), an inline-editable config table (values are edited as
raw JSON so any config shape — number, string, boolean — round-trips), and a roles page
(checkbox permission assignment). All six backend areas are covered by new vitest files
(`tests/admin-*.test.ts`) and were exercised live end-to-end via HTTP against a running dev
server (temp password set/cleared on the seeded admin for the login) and via Playwright in a
real headless-Chromium browser (dashboard chart, driver documents modal, and the create/edit/
suspend/delete flow on every new page) — all test artifacts cleaned up afterward.

Live ops (Phase 4.3): the realtime map is served two ways — a REST snapshot on page load
(`GET /admin/live/drivers`, `GET /admin/live/trips`) plus live deltas pushed over the
already-registered-but-previously-inert `/admin` Socket.IO namespace (see
docs/socket-events.md's `admin:*` rows). `admin:trip_status` is emitted from a single choke
point, `trips/service.ts:transitionTrip` — the only place `Trip.status` ever changes
(CLAUDE.md rule 2) — so every trip lifecycle event (accept, arrive, start, complete, cancel,
payment settle) reaches the admin map for free without touching each call site separately;
`admin:trip_new` is emitted alongside trip creation. `admin:driver_location`/
`admin:driver_status` are emitted from the `driver:location`/`driver:availability` socket
handlers (and from the offline-grace BullMQ job on a disconnect timeout) — mirroring, not
replacing, the existing rider-facing `trip:driver_location` events. `listOnlineDrivers` only
ever returns drivers still in the Redis GEO *dispatch* pool — a driver mid-trip is removed
from that pool the moment they accept (pre-existing `dispatch/service.ts` behavior, unrelated
to this phase), so an on-trip driver's position instead comes through `listActiveTripsForMap`'s
`driverLocation` field, read from the same live state hash. Trip detail's route replay
(`GET /admin/trips/:id`) reuses the exact `trip_locations` query `completeTrip` already ran to
compute actual distance, exposed as `getTripRoute` — flushing the in-process location buffer
first so a still-in-progress trip's most recent pings are included, not just what's already
landed in Postgres. The demand heat map is every trip's pickup point, optionally windowed by
`Trip.createdAt` (`Prisma.sql` composition, since the from/to bounds are each independently
optional); the supply heat map is drivers currently in the GEO pool. Scope decision, disclosed
rather than silently punted: unlike demand, supply has no time filter — there is no historical
driver-position store, only the live GEO index, so `getSupplyHeatmap` is always a "right now"
snapshot regardless of whatever `from`/`to` the caller is using for the demand layer. 8 new
backend tests (`tests/admin-live-ops.test.ts`, `tests/admin-live-socket.test.ts` — the latter
drives real Socket.IO connections end-to-end, same pattern as `tests/realtime-driver.test.ts`);
full suite 260/260 passing 3x clean. Frontend: a new `/admin/live` page (Leaflet +
`react-leaflet` + `react-leaflet-cluster` for driver clustering + `leaflet.heat` for both heat
layers, OpenStreetMap tiles — no API key, unlike the Google Maps path `shared/maps.ts` already
falls back off) with toggleable layers and a live `/admin` socket connection
(`shared/useAdminSocket.ts`) patching an initial REST snapshot; `/admin/trips/:id` (linked from
a live-map trip marker's popup) renders the full trip detail plus a polyline route replay with
a play/pause + scrubber control. Live E2E-verified over real HTTP (temp password set/cleared on
the seeded admin, a driver+trip seeded through the real dispatch/accept/arrive/start path,
`GET /admin/live/trips` and `GET /admin/trips/:id` both returning the expected shape) and via
Playwright in a real browser — 6/6 checks passed, including the replay's play button actually
advancing the scrubber. Disclosed limitation: this sandbox has no outbound network access to
any tile CDN (confirmed via a direct `curl` — `403`/`ERR_TUNNEL_CONNECTION_FAILED`), so the
Leaflet base map itself renders as blank gray tiles here; everything that doesn't depend on
external imagery — markers, popups, clustering, heat layers, the live socket updates, the
route replay polyline and playback — was verified working. This is an environment constraint,
not a code path left untested; it would render normally wherever outbound HTTPS is unrestricted.

Keep this file in sync with the actual Express routers under `apps/api/src/modules/*`.
