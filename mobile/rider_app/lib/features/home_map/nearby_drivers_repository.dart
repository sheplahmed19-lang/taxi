import '../../core/api/dio_client.dart';
import '../../shared/models/nearby_driver.dart';

class NearbyDriversRepository {
  NearbyDriversRepository(this._client);

  final DioClient _client;

  Future<List<NearbyDriver>> nearby({required double lat, required double lng}) => _client.unwrap(
        () => _client.dio.get('/drivers/nearby', queryParameters: {'lat': lat, 'lng': lng}),
        (data) => ((data as Map<String, dynamic>)['drivers'] as List)
            .map((e) => NearbyDriver.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
