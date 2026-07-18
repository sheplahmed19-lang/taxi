import '../../shared/models/auth_user.dart';
import '../api/dio_client.dart';

class UsersRepository {
  UsersRepository(this._client);

  final DioClient _client;

  Future<AuthUser> getMe() => _client.unwrap(
        () => _client.dio.get('/users/me'),
        (data) => AuthUser.fromJson(data as Map<String, dynamic>),
      );
}
