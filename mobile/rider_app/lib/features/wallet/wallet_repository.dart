import '../../core/api/dio_client.dart';

class WalletRepository {
  WalletRepository(this._client);

  final DioClient _client;

  Future<int> getBalance() => _client.unwrap(
        () => _client.dio.get('/wallet/balance'),
        (data) => (data as Map<String, dynamic>)['balance'] as int,
      );
}
