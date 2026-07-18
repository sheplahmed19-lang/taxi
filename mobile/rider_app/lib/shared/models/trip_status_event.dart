import 'package:freezed_annotation/freezed_annotation.dart';

part 'trip_status_event.freezed.dart';
part 'trip_status_event.g.dart';

/// Payload of the `trip:status` socket event. `payload` varies by
/// transition (fare breakdown on completion, cancel reason on cancel), so
/// it's kept as a raw map — screens read only the keys they need.
@freezed
class TripStatusEvent with _$TripStatusEvent {
  const factory TripStatusEvent({
    required String tripId,
    required String status,
    Map<String, dynamic>? payload,
  }) = _TripStatusEvent;

  factory TripStatusEvent.fromJson(Map<String, dynamic> json) => _$TripStatusEventFromJson(json);
}

/// Payload of the `trip:driver_location` socket event.
@freezed
class DriverLocationEvent with _$DriverLocationEvent {
  const factory DriverLocationEvent({
    required double lat,
    required double lng,
    double? heading,
    int? eta,
  }) = _DriverLocationEvent;

  factory DriverLocationEvent.fromJson(Map<String, dynamic> json) => _$DriverLocationEventFromJson(json);
}
