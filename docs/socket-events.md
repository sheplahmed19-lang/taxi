# Socket.IO Event Contract

Namespaces: `/app` (riders+drivers, JWT), `/admin` (staff), `/public` (share tokens)

Rooms: `user:{id}`, `trip:{id}`, `admin:live`

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
| `chat:message` | `{tripId, message}` | trip room | |
| `notification` | `{title, body, data}` | user room | |
| `admin:driver_positions` | `{[...]}` | admin:live | |
| `admin:trip_update` | `{...}` | admin:live | |

Update this file whenever an event or payload changes (see CLAUDE.md rule 9).
