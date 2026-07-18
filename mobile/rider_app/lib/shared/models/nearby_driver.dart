import 'package:freezed_annotation/freezed_annotation.dart';

part 'nearby_driver.freezed.dart';
part 'nearby_driver.g.dart';

@freezed
class NearbyDriver with _$NearbyDriver {
  const factory NearbyDriver({
    required String driverId,
    required String vehicleTypeId,
    required double lat,
    required double lng,
    required double heading,
  }) = _NearbyDriver;

  factory NearbyDriver.fromJson(Map<String, dynamic> json) => _$NearbyDriverFromJson(json);
}
