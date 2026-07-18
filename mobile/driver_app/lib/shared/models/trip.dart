import 'package:freezed_annotation/freezed_annotation.dart';

import 'fare_breakdown.dart';

part 'trip.freezed.dart';
part 'trip.g.dart';

/// Known trip statuses (mirrors apps/api/src/modules/trips/state-machine.ts).
/// Kept as a plain String on the model (not a Dart enum) so an unrecognized
/// value from a newer backend never crashes JSON decoding — only these
/// constants are relied on for UI branching.
abstract class TripStatus {
  static const requested = 'requested';
  static const searching = 'searching';
  static const noDriversFound = 'no_drivers_found';
  static const accepted = 'accepted';
  static const arrived = 'arrived';
  static const started = 'started';
  static const completed = 'completed';
  static const paid = 'paid';
  static const cancelledByRider = 'cancelled_by_rider';
  static const cancelledByDriver = 'cancelled_by_driver';
}

@freezed
class Trip with _$Trip {
  const factory Trip({
    required String id,
    required String riderId,
    String? driverId,
    required String vehicleTypeId,
    required String status,
    String? pickupAddress,
    String? dropAddress,
    String? otp,
    int? distanceM,
    int? durationS,
    FareBreakdown? fareBreakdown,
    int? fareTotal,
    String? paymentMethod,
    String? paymentStatus,
  }) = _Trip;

  factory Trip.fromJson(Map<String, dynamic> json) => _$TripFromJson(json);
}

extension TripX on Trip {
  bool get isActive => ![
        TripStatus.completed,
        TripStatus.paid,
        TripStatus.cancelledByRider,
        TripStatus.cancelledByDriver,
        TripStatus.noDriversFound,
      ].contains(status);
}
