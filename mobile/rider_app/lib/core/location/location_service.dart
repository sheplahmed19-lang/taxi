import 'package:geolocator/geolocator.dart';

/// Thin wrapper over geolocator: permission requests + position streams.
class LocationService {
  Future<Position> getCurrentPosition() {
    return Geolocator.getCurrentPosition();
  }

  Stream<Position> watchPosition() {
    return Geolocator.getPositionStream(
      locationSettings: const LocationSettings(distanceFilter: 10),
    );
  }
}
