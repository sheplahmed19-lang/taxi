import 'package:geolocator/geolocator.dart';

/// Foreground/background location streaming for the online driver.
/// Battery-sane 4s interval + flutter_background_service wiring lands in Phase 1.7.
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
