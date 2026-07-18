/// Plain lat/lng pair mirroring the {lat,lng} shape used across the API.
class LatLngPoint {
  const LatLngPoint({required this.lat, required this.lng});

  final double lat;
  final double lng;

  factory LatLngPoint.fromJson(Map<String, dynamic> json) => LatLngPoint(
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
      );

  Map<String, dynamic> toJson() => {'lat': lat, 'lng': lng};
}
