import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_exception.dart';
import '../../shared/models/latlng.dart';
import '../../shared/models/trip.dart';
import 'trip_session.dart';

class ActiveTripScreen extends ConsumerWidget {
  const ActiveTripScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(driverTripSessionProvider);
    final trip = state.activeTrip;
    if (trip == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    switch (trip.status) {
      case TripStatus.accepted:
        return _NavigateToPickupView(trip: trip, pickup: state.pickup);
      case TripStatus.arrived:
        return _OtpEntryView(trip: trip);
      case TripStatus.started:
        return _OnTripView(trip: trip);
      case TripStatus.completed:
      case TripStatus.paid:
        return _TripCompleteView(trip: trip);
      case TripStatus.cancelledByRider:
      case TripStatus.cancelledByDriver:
        return _CancelledView();
      default:
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
  }
}

Future<void> _openInGoogleMaps(LatLngPoint? point) async {
  if (point == null) return;
  final uri = Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}');
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}

Future<void> _showCancelDialog(BuildContext context, WidgetRef ref) async {
  final controller = TextEditingController();
  final reason = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Cancel trip?'),
      content: TextField(controller: controller, decoration: const InputDecoration(hintText: 'Reason')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Keep trip')),
        TextButton(
          onPressed: () => Navigator.pop(context, controller.text.trim().isEmpty ? 'Unable to complete' : controller.text.trim()),
          child: const Text('Cancel trip'),
        ),
      ],
    ),
  );
  if (reason == null) return;
  await ref.read(driverTripSessionProvider.notifier).cancel(reason);
}

class _NavigateToPickupView extends ConsumerStatefulWidget {
  const _NavigateToPickupView({required this.trip, required this.pickup});
  final Trip trip;
  final LatLngPoint? pickup;

  @override
  ConsumerState<_NavigateToPickupView> createState() => _NavigateToPickupViewState();
}

class _NavigateToPickupViewState extends ConsumerState<_NavigateToPickupView> {
  bool _arriving = false;
  String? _error;

  Future<void> _arrive() async {
    setState(() {
      _arriving = true;
      _error = null;
    });
    try {
      await ref.read(driverTripSessionProvider.notifier).arrive();
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : 'Could not mark arrived');
    } finally {
      if (mounted) setState(() => _arriving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Head to pickup')),
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
                    const Text('Pickup', style: TextStyle(fontWeight: FontWeight.bold)),
                    Text(widget.trip.pickupAddress ?? 'See map'),
                    const SizedBox(height: 8),
                    const Text('Drop-off', style: TextStyle(fontWeight: FontWeight.bold)),
                    Text(widget.trip.dropAddress ?? '—'),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: () => _openInGoogleMaps(widget.pickup),
              icon: const Icon(Icons.map),
              label: const Text('Open in Google Maps'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            const Spacer(),
            ElevatedButton(
              onPressed: _arriving ? null : _arrive,
              child: _arriving
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text("I've arrived"),
            ),
            const SizedBox(height: 8),
            TextButton(onPressed: () => _showCancelDialog(context, ref), child: const Text('Cancel trip')),
          ],
        ),
      ),
    );
  }
}

class _OtpEntryView extends ConsumerStatefulWidget {
  const _OtpEntryView({required this.trip});
  final Trip trip;

  @override
  ConsumerState<_OtpEntryView> createState() => _OtpEntryViewState();
}

class _OtpEntryViewState extends ConsumerState<_OtpEntryView> {
  final _otpController = TextEditingController();
  bool _starting = false;
  String? _error;

  @override
  void dispose() {
    _otpController.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    final otp = _otpController.text.trim();
    if (otp.isEmpty) return;
    setState(() {
      _starting = true;
      _error = null;
    });
    try {
      await ref.read(driverTripSessionProvider.notifier).start(otp);
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : 'Invalid code');
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Enter trip code')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Ask your rider for their 4-digit code'),
            const SizedBox(height: 16),
            TextField(
              controller: _otpController,
              keyboardType: TextInputType.number,
              maxLength: 8,
              decoration: const InputDecoration(labelText: 'Code'),
            ),
            if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ElevatedButton(
              onPressed: _starting ? null : _start,
              child: _starting
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Start trip'),
            ),
            TextButton(onPressed: () => _showCancelDialog(context, ref), child: const Text('Cancel trip')),
          ],
        ),
      ),
    );
  }
}

class _OnTripView extends ConsumerStatefulWidget {
  const _OnTripView({required this.trip});
  final Trip trip;

  @override
  ConsumerState<_OnTripView> createState() => _OnTripViewState();
}

class _OnTripViewState extends ConsumerState<_OnTripView> {
  bool _completing = false;
  String? _error;

  Future<void> _complete() async {
    setState(() {
      _completing = true;
      _error = null;
    });
    try {
      await ref.read(driverTripSessionProvider.notifier).complete();
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : 'Could not complete trip');
    } finally {
      if (mounted) setState(() => _completing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('On trip')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.directions_car, size: 48),
            const SizedBox(height: 16),
            Text('Heading to ${widget.trip.dropAddress ?? 'drop-off'}'),
            if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: _completing ? null : _complete,
              child: _completing
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Complete trip'),
            ),
          ],
        ),
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
      await ref.read(driverTripSessionProvider.notifier).rate(_stars);
      setState(() => _submitted = true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    final isCash = trip.paymentMethod == 'cash';
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
                    Text(isCash ? 'Collect from rider' : 'Fare total', style: const TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('${trip.fareTotal ?? '—'}', style: const TextStyle(fontSize: 28)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            if (!_submitted) ...[
              const Text('Rate your rider', style: TextStyle(fontWeight: FontWeight.bold)),
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
                onPressed: () => ref.read(driverTripSessionProvider.notifier).finishTrip(),
                child: const Text('Back to dashboard'),
              ),
          ],
        ),
      ),
    );
  }
}

class _CancelledView extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cancel_outlined, size: 48),
            const SizedBox(height: 16),
            const Text('Trip cancelled'),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => ref.read(driverTripSessionProvider.notifier).finishTrip(),
              child: const Text('Back to dashboard'),
            ),
          ],
        ),
      ),
    );
  }
}
