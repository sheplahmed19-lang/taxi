import 'package:freezed_annotation/freezed_annotation.dart';

import 'fare_breakdown.dart';
import 'latlng.dart';

part 'trip_offer.freezed.dart';
part 'trip_offer.g.dart';

/// The `trip` sub-object of the `trip:request` socket event — a small
/// snapshot, not the full Trip DTO (see dispatch/service.ts:offerToDriver).
@freezed
class TripOfferStub with _$TripOfferStub {
  const factory TripOfferStub({
    required String id,
    LatLngPoint? pickup,
    String? pickupAddress,
    String? dropAddress,
    int? distanceM,
    int? durationS,
    String? paymentMethod,
  }) = _TripOfferStub;

  factory TripOfferStub.fromJson(Map<String, dynamic> json) => _$TripOfferStubFromJson(json);
}

/// Payload of the `trip:request` socket event.
@freezed
class TripRequestOffer with _$TripRequestOffer {
  const factory TripRequestOffer({
    required TripOfferStub trip,
    FareBreakdown? fareEstimate,
    required num pickupDistance,
    required String expiresAt,
  }) = _TripRequestOffer;

  factory TripRequestOffer.fromJson(Map<String, dynamic> json) => _$TripRequestOfferFromJson(json);
}
