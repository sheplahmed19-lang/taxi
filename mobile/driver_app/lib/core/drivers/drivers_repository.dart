import '../../shared/models/driver_profile.dart';
import '../../shared/models/vehicle_type.dart';
import '../api/api_exception.dart';
import '../api/dio_client.dart';

class DriversRepository {
  DriversRepository(this._client);

  final DioClient _client;

  /// Null when the driver hasn't registered a vehicle yet (404 from the API).
  Future<DriverProfile?> getMyProfile() async {
    try {
      return await _client.unwrap(
        () => _client.dio.get('/drivers/me'),
        (data) => DriverProfile.fromJson(data as Map<String, dynamic>),
      );
    } on ApiException catch (e) {
      if (e.code == 'NOT_FOUND') return null;
      rethrow;
    }
  }

  Future<List<VehicleType>> listVehicleTypes() => _client.unwrap(
        () => _client.dio.get('/vehicles/types'),
        (data) => ((data as Map<String, dynamic>)['types'] as List)
            .map((e) => VehicleType.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<DriverProfile> register({
    required String vehicleTypeId,
    required String plate,
    String? model,
    String? color,
    int? year,
  }) =>
      _client.unwrap(
        () => _client.dio.post('/drivers/register', data: {
          'vehicleTypeId': vehicleTypeId,
          'plate': plate,
          if (model != null && model.isNotEmpty) 'model': model,
          if (color != null && color.isNotEmpty) 'color': color,
          if (year != null) 'year': year,
        }),
        (data) => DriverProfile.fromJson(data as Map<String, dynamic>),
      );

  Future<DriverProfile> setAvailability(bool online) => _client.unwrap(
        () => _client.dio.post('/drivers/availability', data: {'online': online}),
        (data) => DriverProfile.fromJson(data as Map<String, dynamic>),
      );
}
