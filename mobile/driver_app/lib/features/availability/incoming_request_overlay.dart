import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../trip/trip_session.dart';

/// Full-screen incoming trip request: fare estimate, pickup distance, and a
/// countdown to `expiresAt` (the same deadline dispatch/service.ts's BullMQ
/// timeout job enforces server-side — this is a client-side mirror only).
class IncomingRequestOverlay extends ConsumerStatefulWidget {
  const IncomingRequestOverlay({super.key});

  @override
  ConsumerState<IncomingRequestOverlay> createState() => _IncomingRequestOverlayState();
}

class _IncomingRequestOverlayState extends ConsumerState<IncomingRequestOverlay> {
  Timer? _ticker;
  Duration _remaining = Duration.zero;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
    _tick();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  void _tick() {
    final offer = ref.read(driverTripSessionProvider).offer;
    if (offer == null) return;
    final expiresAt = DateTime.tryParse(offer.expiresAt);
    if (expiresAt == null) return;
    final remaining = expiresAt.difference(DateTime.now());
    setState(() => _remaining = remaining.isNegative ? Duration.zero : remaining);
  }

  @override
  Widget build(BuildContext context) {
    final tripState = ref.watch(driverTripSessionProvider);
    final offer = tripState.offer;
    if (offer == null) return const SizedBox.shrink();

    final fare = offer.fareEstimate;
    return Positioned.fill(
      child: Material(
        color: Colors.black87,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('${_remaining.inSeconds}s', style: const TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.bold)),
                const SizedBox(height: 24),
                const Text('New ride request', style: TextStyle(color: Colors.white, fontSize: 22)),
                const SizedBox(height: 16),
                if (offer.trip.pickupAddress != null)
                  Text('Pickup: ${offer.trip.pickupAddress}', style: const TextStyle(color: Colors.white70), textAlign: TextAlign.center),
                if (offer.trip.dropAddress != null)
                  Text('Drop-off: ${offer.trip.dropAddress}', style: const TextStyle(color: Colors.white70), textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Text('${(offer.pickupDistance / 1000).toStringAsFixed(1)} km away', style: const TextStyle(color: Colors.white70)),
                if (fare != null)
                  Text('${fare.total.toStringAsFixed(0)} ${fare.currency}', style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold)),
                if (offer.trip.paymentMethod != null)
                  Text(offer.trip.paymentMethod == 'cash' ? 'Cash' : offer.trip.paymentMethod!, style: const TextStyle(color: Colors.white54)),
                const SizedBox(height: 32),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white)),
                        onPressed: tripState.isResponding ? null : () => ref.read(driverTripSessionProvider.notifier).respond(false),
                        child: const Text('Decline'),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: tripState.isResponding ? null : () => ref.read(driverTripSessionProvider.notifier).respond(true),
                        child: tripState.isResponding
                            ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Text('Accept'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
