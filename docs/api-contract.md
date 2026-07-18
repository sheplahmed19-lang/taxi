# API Surface Summary (v1)

Base path: `/api/v1`. Responses: `{ success, data | error }`.

```
/auth        otp/request, otp/verify, refresh, staff/login
/users       me, me (PATCH), favorites CRUD, notifications list
/drivers     register, documents, availability, nearby, earnings, statements, owe, subscription
/vehicles    types (list, any authenticated role), CRUD (admin, not yet implemented)
/fares       estimate
/trips       create, :id, :id/accept|arrive|start|complete|cancel, :id/rate, history, :id/track (public token)
/scheduled   CRUD
/wallet      balance, transactions (cursor pagination), topup/init (body: {amount, currency?, gateway?} —
             gateway is "stripe" (default) or "paystack"); wallet is also a trip paymentMethod, settled
             atomically at trip completion with an automatic fallback to cash on insufficient balance
/payments    ride/:tripId/init (charges a completed card-pay trip's final fare; body: {gateway?}),
             webhook/:gateway (signature-verified, idempotent — :gateway is "stripe" or "paystack",
             each with its own signature header); methods CRUD not yet implemented
/payouts     request, admin approve/reject/paid
/promos      validate, apply; admin CRUD
/referrals   my-code, stats
/chat        :tripId/messages
/admin       dashboard, drivers, users, staff, roles, zones, config,
             trips, manual-booking, broadcasts, reports/*, heatmap
```

Keep this file in sync with the actual Express routers under `apps/api/src/modules/*`.
