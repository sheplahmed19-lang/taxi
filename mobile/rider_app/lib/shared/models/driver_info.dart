import 'package:freezed_annotation/freezed_annotation.dart';

part 'driver_info.freezed.dart';
part 'driver_info.g.dart';

@freezed
class DriverInfo with _$DriverInfo {
  const factory DriverInfo({
    required String id,
    String? name,
    required String phone,
  }) = _DriverInfo;

  factory DriverInfo.fromJson(Map<String, dynamic> json) => _$DriverInfoFromJson(json);
}

@freezed
class VehicleInfo with _$VehicleInfo {
  const factory VehicleInfo({
    required String id,
    required String plate,
    String? model,
    String? color,
    int? year,
  }) = _VehicleInfo;

  factory VehicleInfo.fromJson(Map<String, dynamic> json) => _$VehicleInfoFromJson(json);
}

@freezed
class TripAcceptedStub with _$TripAcceptedStub {
  const factory TripAcceptedStub({
    required String id,
    required String status,
    String? otp,
  }) = _TripAcceptedStub;

  factory TripAcceptedStub.fromJson(Map<String, dynamic> json) => _$TripAcceptedStubFromJson(json);
}

/// Payload of the `trip:accepted` socket event — the nested `trip` here is
/// intentionally the small {id,status,otp} shape the server actually sends
/// (see dispatch/service.ts), not the full Trip DTO.
@freezed
class TripAccepted with _$TripAccepted {
  const factory TripAccepted({
    required TripAcceptedStub trip,
    DriverInfo? driver,
    VehicleInfo? vehicle,
    int? eta,
  }) = _TripAccepted;

  factory TripAccepted.fromJson(Map<String, dynamic> json) => _$TripAcceptedFromJson(json);
}
