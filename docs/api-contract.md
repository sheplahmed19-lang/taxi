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
/vehicles    types (list, any authenticated role), CRUD (admin, not yet implemented)
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
/chat        :tripId/messages
/admin       dashboard, drivers, users, staff, roles, zones, config,
             trips, manual-booking, broadcasts, reports/*, heatmap,
             subscriptions/plans (POST), subscriptions/plans/:id (PATCH),
             payouts (list, filter by status), payouts/:id/approve|reject|paid,
             owe (report of drivers with a positive balance), owe/:driverId/adjust
             (body: {delta, reason} — signed delta, clamped at 0, audit-logged),
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

Weekly driver statements: a Monday-00:00 BullMQ cron
(`jobs/weeklyStatements.ts:scheduleWeeklyStatementsCron`) generates a CSV per
approved driver (trip count, gross fare, commission, net earning for the
past 7 days) and uploads it via the existing S3-compatible object storage.
Not verifiable end-to-end in this sandbox — no MinIO instance is running
here (see CLAUDE.md's Docker note) — but `generateDriverStatement`'s upload
step is injectable and fully covered by tests without it.

Keep this file in sync with the actual Express routers under `apps/api/src/modules/*`.
