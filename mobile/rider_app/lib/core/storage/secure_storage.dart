import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Secure storage for access/refresh tokens.
class SecureStorage {
  final _storage = const FlutterSecureStorage();

  Future<void> writeAccessToken(String token) =>
      _storage.write(key: 'access_token', value: token);

  Future<String?> readAccessToken() => _storage.read(key: 'access_token');
}
