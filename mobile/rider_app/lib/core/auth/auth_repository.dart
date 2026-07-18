import '../../shared/models/auth_user.dart';
import '../api/dio_client.dart';

class OtpVerifyResult {
  const OtpVerifyResult({required this.user, required this.accessToken, required this.refreshToken});

  final AuthUser user;
  final String accessToken;
  final String refreshToken;
}

/// Talks to /auth/otp/*. See CLAUDE.md rule 8 for the response envelope.
class AuthRepository {
  AuthRepository(this._client);

  final DioClient _client;

  Future<void> requestOtp(String phone) => _client.unwrap(
        () => _client.dio.post('/auth/otp/request', data: {'phone': phone}),
        (_) {},
      );

  Future<OtpVerifyResult> verifyOtp(String phone, String otp, String role) => _client.unwrap(
        () => _client.dio.post('/auth/otp/verify', data: {'phone': phone, 'otp': otp, 'role': role}),
        (data) => OtpVerifyResult(
          user: AuthUser.fromJson(data['user'] as Map<String, dynamic>),
          accessToken: data['accessToken'] as String,
          refreshToken: data['refreshToken'] as String,
        ),
      );
}
