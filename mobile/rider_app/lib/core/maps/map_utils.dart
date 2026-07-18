import 'package:flutter/material.dart' show Color;
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../shared/models/latlng.dart';

/// Small map helpers shared by the booking/trip screens.
///
/// Route polylines from Google Directions require a server-side Directions
/// call (and a Maps API key we don't have configured in this environment),
/// so [straightLine] is used as an honest stand-in — a direct pickup→drop
/// segment rather than a fabricated road-following route.
class MapUtils {
  static LatLng toGoogleLatLng(LatLngPoint point) => LatLng(point.lat, point.lng);

  static Set<Polyline> straightLine(String id, LatLngPoint a, LatLngPoint b) => {
        Polyline(
          polylineId: PolylineId(id),
          points: [toGoogleLatLng(a), toGoogleLatLng(b)],
          color: const Color(0xFF7C3AED),
          width: 4,
        ),
      };

  static LatLngBounds boundsFor(List<LatLngPoint> points) {
    final lats = points.map((p) => p.lat);
    final lngs = points.map((p) => p.lng);
    return LatLngBounds(
      southwest: LatLng(lats.reduce((a, b) => a < b ? a : b), lngs.reduce((a, b) => a < b ? a : b)),
      northeast: LatLng(lats.reduce((a, b) => a > b ? a : b), lngs.reduce((a, b) => a > b ? a : b)),
    );
  }
}
