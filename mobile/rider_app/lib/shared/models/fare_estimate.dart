import 'package:freezed_annotation/freezed_annotation.dart';

import 'fare_breakdown.dart';

part 'fare_estimate.freezed.dart';
part 'fare_estimate.g.dart';

@freezed
class FareEstimate with _$FareEstimate {
  const factory FareEstimate({
    required String vehicleTypeId,
    required String vehicleTypeName,
    required int distanceM,
    required int durationS,
    required FareBreakdown breakdown,
  }) = _FareEstimate;

  factory FareEstimate.fromJson(Map<String, dynamic> json) => _$FareEstimateFromJson(json);
}
