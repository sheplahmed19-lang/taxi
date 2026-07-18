import '../../core/api/dio_client.dart';
import '../../shared/models/trip.dart';

class TripRepository {
  TripRepository(this._client);

  final DioClient _client;

  Future<Trip> getTrip(String tripId) => _client.unwrap(
        () => _client.dio.get('/trips/$tripId'),
        (data) => Trip.fromJson(data as Map<String, dynamic>),
      );

  Future<Trip> arriveTrip(String tripId) => _client.unwrap(
        () => _client.dio.post('/trips/$tripId/arrive'),
        (data) => Trip.fromJson(data as Map<String, dynamic>),
      );

  Future<Trip> startTrip(String tripId, String otp) => _client.unwrap(
        () => _client.dio.post('/trips/$tripId/start', data: {'otp': otp}),
        (data) => Trip.fromJson(data as Map<String, dynamic>),
      );

  Future<Trip> completeTrip(String tripId) => _client.unwrap(
        () => _client.dio.post('/trips/$tripId/complete'),
        (data) => Trip.fromJson(data as Map<String, dynamic>),
      );

  Future<Trip> cancelTrip(String tripId, String reason) => _client.unwrap(
        () => _client.dio.post('/trips/$tripId/cancel', data: {'reason': reason}),
        (data) => Trip.fromJson(data as Map<String, dynamic>),
      );

  Future<void> rateTrip(String tripId, int stars, {String? review}) => _client.unwrap(
        () => _client.dio.post('/trips/$tripId/rate', data: {
          'stars': stars,
          if (review != null && review.isNotEmpty) 'review': review,
        }),
        (_) {},
      );
}
