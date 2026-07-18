import 'package:dio/dio.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import '../storage/secure_storage.dart';
import 'api_exception.dart';

/// Dio client with an auth interceptor: attaches the access token to every
/// request, and on a 401 tries a single token refresh + retry before giving
/// up. [onSessionExpired] fires when the refresh itself fails, so the app
/// can drop back to the login screen.
class DioClient {
  DioClient(this._secureStorage, {this.onSessionExpired}) : dio = Dio(BaseOptions(baseUrl: baseUrl)) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (!_isAuthPath(options.path)) {
            final token = await _secureStorage.readAccessToken();
            if (token != null) {
              options.headers['Authorization'] = 'Bearer $token';
            }
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final status = error.response?.statusCode;
          final alreadyRetried = error.requestOptions.extra['retried'] == true;
          if (status == 401 && !alreadyRetried && !_isAuthPath(error.requestOptions.path)) {
            final refreshed = await _tryRefresh();
            if (refreshed != null) {
              final retryOptions = error.requestOptions
                ..headers['Authorization'] = 'Bearer $refreshed'
                ..extra['retried'] = true;
              try {
                final response = await dio.fetch(retryOptions);
                handler.resolve(response);
                return;
              } on DioException catch (retryError) {
                handler.next(retryError);
                return;
              }
            }
            await _secureStorage.clear();
            onSessionExpired?.call();
          }
          handler.next(error);
        },
      ),
    );
  }

  static String get baseUrl => dotenv.env['API_BASE_URL'] ?? '';

  final Dio dio;
  final SecureStorage _secureStorage;
  final void Function()? onSessionExpired;

  bool _isAuthPath(String path) =>
      path.contains('/auth/otp/') || path.contains('/auth/refresh') || path.contains('/auth/staff/login');

  Future<String?> _tryRefresh() async {
    final refreshToken = await _secureStorage.readRefreshToken();
    if (refreshToken == null) return null;
    try {
      final plain = Dio(BaseOptions(baseUrl: baseUrl));
      final response = await plain.post('/auth/refresh', data: {'refreshToken': refreshToken});
      final data = response.data['data'] as Map<String, dynamic>;
      final newAccess = data['accessToken'] as String;
      final newRefresh = data['refreshToken'] as String;
      await _secureStorage.writeTokens(accessToken: newAccess, refreshToken: newRefresh);
      return newAccess;
    } catch (_) {
      return null;
    }
  }

  /// Unwraps `{success,data|error}` into `data`, throwing [ApiException] on
  /// `{success:false}` or any transport-level failure.
  Future<T> unwrap<T>(Future<Response> Function() call, T Function(dynamic data) map) async {
    try {
      final response = await call();
      final body = response.data as Map<String, dynamic>;
      if (body['success'] != true) {
        final error = body['error'] as Map<String, dynamic>?;
        throw ApiException(error?['message'] as String? ?? 'Request failed', code: error?['code'] as String?);
      }
      return map(body['data']);
    } on DioException catch (e) {
      final body = e.response?.data;
      if (body is Map<String, dynamic> && body['error'] is Map) {
        final error = body['error'] as Map<String, dynamic>;
        throw ApiException(error['message'] as String? ?? e.message ?? 'Network error', code: error['code'] as String?);
      }
      throw ApiException(e.message ?? 'Network error');
    }
  }
}
