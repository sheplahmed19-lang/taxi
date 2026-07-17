import 'package:dio/dio.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Dio client with auth interceptor + token refresh flow.
/// Full interceptor logic (attach access token, refresh on 401) lands in Phase 0.6/1.7.
class DioClient {
  DioClient()
      : dio = Dio(BaseOptions(baseUrl: dotenv.env['API_BASE_URL'] ?? ''));

  final Dio dio;
}
