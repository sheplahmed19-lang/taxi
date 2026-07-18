import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../core/auth/auth_session.dart';
import '../../shared/models/nearby_driver.dart';
import '../booking/booking_screen.dart';
import 'nearby_drivers_repository.dart';

final nearbyDriversRepositoryProvider =
    Provider<NearbyDriversRepository>((ref) => NearbyDriversRepository(ref.watch(dioClientProvider)));

/// Home map with current location + nearby cars + entry point into booking.
class HomeMapScreen extends ConsumerStatefulWidget {
  const HomeMapScreen({super.key});

  @override
  ConsumerState<HomeMapScreen> createState() => _HomeMapScreenState();
}

class _HomeMapScreenState extends ConsumerState<HomeMapScreen> {
  static const _fallbackCenter = LatLng(30.05, 31.23);

  LatLng _center = _fallbackCenter;
  List<NearbyDriver> _nearby = [];
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _init();
    _pollTimer = Timer.periodic(const Duration(seconds: 8), (_) => _refreshNearby());
  }

  Future<void> _init() async {
    try {
      final position = await ref.read(locationServiceProvider).getCurrentPosition();
      if (mounted) setState(() => _center = LatLng(position.latitude, position.longitude));
    } catch (_) {
      // Permission denied or unavailable — fall back to the default map center.
    }
    await _refreshNearby();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _refreshNearby() async {
    try {
      final drivers = await ref.read(nearbyDriversRepositoryProvider).nearby(lat: _center.latitude, lng: _center.longitude);
      if (mounted) setState(() => _nearby = drivers);
    } catch (_) {
      // Best-effort — a stale/empty nearby-cars layer isn't worth surfacing an error for.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ride'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authSessionProvider.notifier).logout(),
          ),
        ],
      ),
      body: GoogleMap(
        initialCameraPosition: CameraPosition(target: _center, zoom: 13),
        myLocationEnabled: true,
        myLocationButtonEnabled: true,
        markers: _nearby
            .map((d) => Marker(
                  markerId: MarkerId(d.driverId),
                  position: LatLng(d.lat, d.lng),
                  icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueViolet),
                  rotation: d.heading,
                  anchor: const Offset(0.5, 0.5),
                  flat: true,
                ))
            .toSet(),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/booking'),
        icon: const Icon(Icons.search),
        label: const Text('Where to?'),
      ),
    );
  }
}
