import 'package:freezed_annotation/freezed_annotation.dart';

part 'driver_profile.freezed.dart';
part 'driver_profile.g.dart';

/// Known values of DriverVerificationStatus (prisma/schema.prisma).
abstract class VerificationStatus {
  static const pending = 'pending';
  static const approved = 'approved';
  static const rejected = 'rejected';
}

@freezed
class DriverProfile with _$DriverProfile {
  const factory DriverProfile({
    required String userId,
    required String verificationStatus,
    String? rejectionReason,
    required bool online,
  }) = _DriverProfile;

  factory DriverProfile.fromJson(Map<String, dynamic> json) => _$DriverProfileFromJson(json);
}
