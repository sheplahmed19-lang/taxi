# Socket.IO Event Contract

Namespaces: `/app` (riders+drivers, JWT), `/admin` (staff), `/public` (share tokens —
handshake `auth: {tripId, token}`, `token` from `POST /trips/:id/share`; auto-joins `trip:{id}`
on connect, read-only, no client→server events)

Rooms: `user:{id}`, `trip:{id}`, `admin:live`

`trip:{id}` is shared across `/app` and `/public` — `emitToTrip` broadcasts to both, so a
`/public` tracker with a valid token receives the same `trip:driver_location`/`trip:status`/
`trip:fare_updated` events listed below as a logged-in participant would.

## Client → Server

| Event | Payload | Sender | Notes |
|---|---|---|---|
| `driver:location` | `{lat,lng,heading,speed,ts}` | driver | every 3–5s |
| `driver:availability` | `{online: bool}` | driver | |
| `trip:driver_response` | `{tripId, accept: bool}` | driver | |
| `chat:send` | `{tripId, body}` | rider/driver | |

## Server → Client

| Event | Payload | Recipient | Notes |
|---|---|---|---|
| `trip:request` | `{trip: {id,pickup:{lat,lng},pickupAddress,dropAddress,distanceM,durationS,paymentMethod}, fareEstimate, pickupDistance, expiresAt}` | driver | |
| `trip:request_expired` | `{tripId}` | driver | |
| `trip:accepted` | `{trip, driver, vehicle, eta}` | rider | |
| `trip:driver_location` | `{lat,lng,heading,eta}` | trip room | |
| `trip:status` | `{tripId, status, payload}` | trip room | arrived/started/completed/cancelled |
| `trip:fare_updated` | `{tripId, fareBreakdown, fareTotal}` | trip room | a promo code was applied via `POST /promos/apply` after trip creation |
| `trip:no_drivers` | `{tripId}` | rider | |
| `chat:message` | `{tripId, message}` | trip room | `message` is the full ChatMessage row incl. `sender: {id,name,role}` |
| `notification` | `{title, body, data}` | user room | |
| `admin:driver_positions` | `{[...]}` | admin:live | |
| `admin:trip_update` | `{...}` | admin:live | |

Update this file whenever an event or payload changes (see CLAUDE.md rule 9).
