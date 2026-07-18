# API Surface Summary (v1)

Base path: `/api/v1`. Responses: `{ success, data | error }`.

```
/auth        otp/request, otp/verify, refresh, staff/login
/users       me, me (PATCH), favorites CRUD, notifications list
/drivers     register, documents, availability, nearby, earnings (not yet implemented),
             statements (list, signed download URL per statement), owe (GET), owe/pay (POST,
             settles the full outstanding amount from the driver's own wallet)
/vehicles    types (list, any authenticated role), CRUD (admin, not yet implemented)
/fares       estimate
/trips       create (body may include promoCode, applied atomically with the fare estimate),
             :id, :id/accept|arrive|start|complete|cancel, :id/rate, history, :id/track (public token)
/scheduled   CRUD
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
/referrals   my-code, stats
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

Weekly driver statements: a Monday-00:00 BullMQ cron
(`jobs/weeklyStatements.ts:scheduleWeeklyStatementsCron`) generates a CSV per
approved driver (trip count, gross fare, commission, net earning for the
past 7 days) and uploads it via the existing S3-compatible object storage.
Not verifiable end-to-end in this sandbox — no MinIO instance is running
here (see CLAUDE.md's Docker note) — but `generateDriverStatement`'s upload
step is injectable and fully covered by tests without it.

Keep this file in sync with the actual Express routers under `apps/api/src/modules/*`.
