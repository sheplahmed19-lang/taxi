import '../../core/api/dio_client.dart';
import '../../shared/models/fare_estimate.dart';
import '../../shared/models/latlng.dart';

class FareRepository {
  FareRepository(this._client);

  final DioClient _client;

  Future<List<FareEstimate>> estimate({required LatLngPoint pickup, required LatLngPoint drop}) => _client.unwrap(
        () => _client.dio.post('/fares/estimate', data: {'pickup': pickup.toJson(), 'drop': drop.toJson()}),
        (data) => (data['estimates'] as List)
            .map((e) => FareEstimate.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
