import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/maps/map_utils.dart';
import '../../shared/models/trip.dart';
import 'trip_session.dart';

class ActiveTripScreen extends ConsumerWidget {
  const ActiveTripScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(tripSessionProvider);
    final trip = session.trip;

    if (trip == null) {
      // No active trip — bounce back to the map rather than showing a blank screen.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted) context.go('/home');
      });
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    switch (trip.status) {
      case TripStatus.requested:
      case TripStatus.searching:
        return _SearchingView(onCancel: () => _cancel(context, ref));
      case TripStatus.noDriversFound:
        return _NoDriversView(onDismiss: () {
          ref.read(tripSessionProvider.notifier).reset();
          context.go('/home');
        });
      case TripStatus.accepted:
      case TripStatus.arrived:
        return _DriverAssignedView(session: session, onCancel: () => _cancel(context, ref));
      case TripStatus.started:
        return _OnTripView(session: session);
      case TripStatus.completed:
      case TripStatus.paid:
        return _TripCompleteView(trip: trip);
      case TripStatus.cancelledByRider:
      case TripStatus.cancelledByDriver:
        return _CancelledView(onDismiss: () {
          ref.read(tripSessionProvider.notifier).reset();
          context.go('/home');
        });
      default:
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (context) {
        final controller = TextEditingController();
        return AlertDialog(
          title: const Text('Cancel ride?'),
          content: TextField(controller: controller, decoration: const InputDecoration(hintText: 'Reason')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Keep ride')),
            TextButton(
              onPressed: () => Navigator.pop(context, controller.text.trim().isEmpty ? 'Changed my mind' : controller.text.trim()),
              child: const Text('Cancel ride'),
            ),
          ],
        );
      },
    );
    if (reason == null) return;
    await ref.read(tripSessionProvider.notifier).cancelTrip(reason);
  }
}

class _SearchingView extends StatelessWidget {
  const _SearchingView({required this.onCancel});
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            const Text('Finding you a driver…', style: TextStyle(fontSize: 18)),
            const SizedBox(height: 24),
            OutlinedButton(onPressed: onCancel, child: const Text('Cancel')),
          ],
        ),
      ),
    );
  }
}

class _NoDriversView extends StatelessWidget {
  const _NoDriversView({required this.onDismiss});
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.search_off, size: 48),
            const SizedBox(height: 16),
            const Text('No drivers available right now'),
            const SizedBox(height: 24),
            ElevatedButton(onPressed: onDismiss, child: const Text('Back to map')),
          ],
        ),
      ),
    );
  }
}

class _CancelledView extends StatelessWidget {
  const _CancelledView({required this.onDismiss});
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cancel_outlined, size: 48),
            const SizedBox(height: 16),
            const Text('Ride cancelled'),
            const SizedBox(height: 24),
            ElevatedButton(onPressed: onDismiss, child: const Text('Back to map')),
          ],
        ),
      ),
    );
  }
}

class _DriverAssignedView extends StatelessWidget {
  const _DriverAssignedView({required this.session, required this.onCancel});
  final TripSessionState session;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final trip = session.trip!;
    final arrived = trip.status == TripStatus.arrived;
    return Scaffold(
      appBar: AppBar(title: Text(arrived ? 'Your driver has arrived' : 'Driver on the way')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    const CircleAvatar(radius: 28, child: Icon(Icons.person)),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(session.driver?.name ?? 'Your driver', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                          if (session.vehicle != null)
                            Text('${session.vehicle!.color ?? ''} ${session.vehicle!.model ?? ''} · ${session.vehicle!.plate}'.trim()),
                          if (session.eta != null) Text('ETA ${(session.eta! / 60).ceil()} min'),
                        ],
                      ),
                    ),
                    if (session.driver?.phone != null)
                      IconButton(
                        icon: const Icon(Icons.call),
                        onPressed: () => launchUrl(Uri.parse('tel:${session.driver!.phone}')),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (trip.otp != null)
              Card(
                color: Theme.of(context).colorScheme.primaryContainer,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      const Text('Share this code with your driver to start the trip'),
                      const SizedBox(height: 8),
                      Text(trip.otp!, style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, letterSpacing: 8)),
                    ],
                  ),
                ),
              ),
            const Spacer(),
            OutlinedButton(onPressed: onCancel, child: const Text('Cancel ride')),
          ],
        ),
      ),
    );
  }
}

class _OnTripView extends StatelessWidget {
  const _OnTripView({required this.session});
  final TripSessionState session;

  @override
  Widget build(BuildContext context) {
    final driverLocation = session.driverLocation;
    return Scaffold(
      appBar: AppBar(title: const Text('On the way')),
      body: Column(
        children: [
          Expanded(
            child: driverLocation == null
                ? const Center(child: Text('Waiting for driver location…'))
                : GoogleMap(
                    initialCameraPosition: CameraPosition(target: MapUtils.toGoogleLatLng(driverLocation), zoom: 14),
                    markers: {
                      Marker(markerId: const MarkerId('driver'), position: MapUtils.toGoogleLatLng(driverLocation)),
                    },
                  ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              session.eta != null ? 'Arriving in ${(session.eta! / 60).ceil()} min' : 'Trip in progress',
              style: const TextStyle(fontSize: 16),
            ),
          ),
        ],
      ),
    );
  }
}

class _TripCompleteView extends ConsumerStatefulWidget {
  const _TripCompleteView({required this.trip});
  final Trip trip;

  @override
  ConsumerState<_TripCompleteView> createState() => _TripCompleteViewState();
}

class _TripCompleteViewState extends ConsumerState<_TripCompleteView> {
  int _stars = 5;
  bool _submitting = false;
  bool _submitted = false;

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      await ref.read(tripSessionProvider.notifier).rateTrip(_stars);
      setState(() => _submitted = true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    return Scaffold(
      appBar: AppBar(title: const Text('Trip complete')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Fare total', style: TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('${trip.fareTotal ?? '—'}', style: const TextStyle(fontSize: 28)),
                    if (trip.paymentMethod == 'cash') const Text('Paid in cash'),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            if (!_submitted) ...[
              const Text('Rate your driver', style: TextStyle(fontWeight: FontWeight.bold)),
              Row(
                children: List.generate(
                  5,
                  (i) => IconButton(
                    icon: Icon(i < _stars ? Icons.star : Icons.star_border, color: Colors.amber),
                    onPressed: () => setState(() => _stars = i + 1),
                  ),
                ),
              ),
              ElevatedButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Submit rating'),
              ),
            ] else
              ElevatedButton(
                onPressed: () {
                  ref.read(tripSessionProvider.notifier).reset();
                  context.go('/home');
                },
                child: const Text('Done'),
              ),
          ],
        ),
      ),
    );
  }
}
