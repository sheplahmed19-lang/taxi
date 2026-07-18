import 'package:freezed_annotation/freezed_annotation.dart';

part 'fare_breakdown.freezed.dart';
part 'fare_breakdown.g.dart';

@freezed
class FareBreakdown with _$FareBreakdown {
  const factory FareBreakdown({
    required num base,
    required num distanceFare,
    required num timeFare,
    required num nightOrPeakMultiplier,
    required num surge,
    required num promoDiscount,
    required num total,
    required String currency,
  }) = _FareBreakdown;

  factory FareBreakdown.fromJson(Map<String, dynamic> json) => _$FareBreakdownFromJson(json);
}
