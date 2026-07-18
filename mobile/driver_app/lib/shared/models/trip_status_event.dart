import 'package:freezed_annotation/freezed_annotation.dart';

part 'trip_status_event.freezed.dart';
part 'trip_status_event.g.dart';

/// Payload of the `trip:status` socket event. `payload` varies by
/// transition, so it's kept as a raw map — screens read only the keys they need.
@freezed
class TripStatusEvent with _$TripStatusEvent {
  const factory TripStatusEvent({
    required String tripId,
    required String status,
    Map<String, dynamic>? payload,
  }) = _TripStatusEvent;

  factory TripStatusEvent.fromJson(Map<String, dynamic> json) => _$TripStatusEventFromJson(json);
}
