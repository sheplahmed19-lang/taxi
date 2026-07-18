import 'package:freezed_annotation/freezed_annotation.dart';

part 'vehicle_type.freezed.dart';
part 'vehicle_type.g.dart';

@freezed
class VehicleType with _$VehicleType {
  const factory VehicleType({
    required String id,
    required String name,
    String? icon,
    required int seats,
    required int baseFare,
    required int perKm,
    required int perMin,
    required int minFare,
  }) = _VehicleType;

  factory VehicleType.fromJson(Map<String, dynamic> json) => _$VehicleTypeFromJson(json);
}
