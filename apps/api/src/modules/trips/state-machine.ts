/**
 * Trip state machine. All trip status transitions MUST go through transitionTrip()
 * in trips/service.ts, which validates against this table. See CLAUDE.md rule 2.
 */
export type TripStatus =
  | "requested"
  | "searching"
  | "accepted"
  | "arrived"
  | "started"
  | "completed"
  | "paid"
  | "cancelled_by_rider"
  | "cancelled_by_driver"
  | "no_drivers_found"
  | "expired"
  | "scheduled";

export type TripEvent =
  | "dispatch"
  | "driver_accept"
  | "driver_arrive"
  | "trip_start"
  | "trip_complete"
  | "payment_settled"
  | "rider_cancel"
  | "driver_cancel"
  | "exhaust_drivers"
  | "expire";

const transitions: Record<TripStatus, Partial<Record<TripEvent, TripStatus>>> = {
  requested: { dispatch: "searching", rider_cancel: "cancelled_by_rider" },
  searching: {
    driver_accept: "accepted",
    exhaust_drivers: "no_drivers_found",
    rider_cancel: "cancelled_by_rider",
    expire: "expired",
  },
  accepted: {
    driver_arrive: "arrived",
    rider_cancel: "cancelled_by_rider",
    driver_cancel: "cancelled_by_driver",
  },
  arrived: {
    trip_start: "started",
    rider_cancel: "cancelled_by_rider",
    driver_cancel: "cancelled_by_driver",
  },
  started: { trip_complete: "completed" },
  completed: { payment_settled: "paid" },
  paid: {},
  cancelled_by_rider: {},
  cancelled_by_driver: {},
  no_drivers_found: {},
  expired: {},
  scheduled: { dispatch: "searching", rider_cancel: "cancelled_by_rider" },
};

export function nextStatus(current: TripStatus, event: TripEvent): TripStatus | null {
  return transitions[current]?.[event] ?? null;
}
