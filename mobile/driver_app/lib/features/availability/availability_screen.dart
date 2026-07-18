import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_session.dart';
import '../../core/location/location_service.dart';
import '../../shared/models/driver_profile.dart';
import '../trip/active_trip_screen.dart';
import '../trip/trip_session.dart';
import 'incoming_request_overlay.dart';

final locationServiceProvider = Provider<LocationService>((ref) => LocationService());

/// Online/offline toggle + foreground location streaming. While online, the
/// driver's position is emitted over the socket every ~4s (battery-sane —
/// see docs/plan.md 1.7) so drivers/service.ts:recordLocation can keep the
/// Redis GEO index current for dispatch.
class AvailabilityScreen extends ConsumerStatefulWidget {
  const AvailabilityScreen({super.key, required this.profile});

  final DriverProfile profile;

  @override
  ConsumerState<AvailabilityScreen> createState() => _AvailabilityScreenState();
}

class _AvailabilityScreenState extends ConsumerState<AvailabilityScreen> {
  late bool _online = widget.profile.online;
  bool _toggling = false;
  String? _error;
  StreamSubscription<Position>? _positionSub;

  @override
  void initState() {
    super.initState();
    if (_online) _startLocationStream();
  }

  @override
  void dispose() {
    _positionSub?.cancel();
    super.dispose();
  }

  void _startLocationStream() {
    _positionSub?.cancel();
    _positionSub = ref.read(locationServiceProvider).watchPosition().listen((position) {
      ref.read(socketServiceProvider).emit('driver:location', {
        'lat': position.latitude,
        'lng': position.longitude,
        'heading': position.heading,
        'speed': position.speed,
        'ts': DateTime.now().millisecondsSinceEpoch,
      });
    });
  }

  Future<void> _toggle(bool value) async {
    setState(() {
      _toggling = true;
      _error = null;
    });
    try {
      await ref.read(driversRepositoryProvider).setAvailability(value);
      setState(() => _online = value);
      if (value) {
        _startLocationStream();
      } else {
        _positionSub?.cancel();
      }
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : 'Could not update availability');
    } finally {
      if (mounted) setState(() => _toggling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tripState = ref.watch(driverTripSessionProvider);

    ref.listen(driverTripSessionProvider.select((s) => s.offerLost), (previous, offerLost) {
      if (offerLost == true) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('That ride was already taken')));
        ref.read(driverTripSessionProvider.notifier).dismissOfferLost();
      }
    });

    if (tripState.activeTrip != null) {
      return const ActiveTripScreen();
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Ride — Driver'),
        actions: [
          IconButton(icon: const Icon(Icons.logout), onPressed: () => ref.read(authSessionProvider.notifier).logout()),
        ],
      ),
      body: Stack(
        children: [
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(_online ? Icons.wifi_tethering : Icons.wifi_tethering_off, size: 64, color: _online ? Colors.green : Colors.grey),
                const SizedBox(height: 16),
                Text(_online ? "You're online" : "You're offline", style: const TextStyle(fontSize: 20)),
                const SizedBox(height: 24),
                Switch(value: _online, onChanged: _toggling ? null : _toggle),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
              ],
            ),
          ),
          if (tripState.offer != null) const IncomingRequestOverlay(),
        ],
      ),
    );
  }
}
