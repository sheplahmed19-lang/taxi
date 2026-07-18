import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_session.dart';
import '../../core/location/location_service.dart';
import '../../shared/models/fare_estimate.dart';
import '../../shared/models/latlng.dart';
import '../trip/trip_session.dart';
import '../wallet/wallet_repository.dart';
import 'fare_repository.dart';
import 'map_picker_screen.dart';

final fareRepositoryProvider = Provider<FareRepository>((ref) => FareRepository(ref.watch(dioClientProvider)));
final locationServiceProvider = Provider<LocationService>((ref) => LocationService());
final walletRepositoryProvider = Provider<WalletRepository>((ref) => WalletRepository(ref.watch(dioClientProvider)));

class BookingScreen extends ConsumerStatefulWidget {
  const BookingScreen({super.key});

  @override
  ConsumerState<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends ConsumerState<BookingScreen> {
  LatLngPoint? _pickup;
  String _pickupLabel = 'Current location';
  LatLngPoint? _drop;
  String _dropLabel = '';

  List<FareEstimate> _estimates = [];
  String? _selectedVehicleTypeId;
  bool _loadingEstimates = false;
  bool _requesting = false;
  String? _error;

  String _paymentMethod = 'cash';
  int? _walletBalance;

  @override
  void initState() {
    super.initState();
    _loadCurrentLocation();
    _loadWalletBalance();
  }

  Future<void> _loadWalletBalance() async {
    try {
      final balance = await ref.read(walletRepositoryProvider).getBalance();
      if (mounted) setState(() => _walletBalance = balance);
    } catch (_) {
      // Non-critical — the payment-method selector still works without a balance preview.
    }
  }

  Future<void> _loadCurrentLocation() async {
    try {
      final position = await ref.read(locationServiceProvider).getCurrentPosition();
      if (!mounted) return;
      setState(() => _pickup = LatLngPoint(lat: position.latitude, lng: position.longitude));
    } catch (_) {
      // Location permission denied or unavailable — the rider can still set
      // pickup manually via the map picker.
    }
  }

  Future<void> _pickPickup() async {
    final result = await Navigator.of(context).push<({LatLngPoint point, String address})>(
      MaterialPageRoute(
        builder: (_) => MapPickerScreen(title: 'Pickup location', initial: _pickup ?? const LatLngPoint(lat: 30.05, lng: 31.23)),
      ),
    );
    if (result == null) return;
    setState(() {
      _pickup = result.point;
      _pickupLabel = result.address.isEmpty ? 'Pickup pin' : result.address;
    });
    _maybeFetchEstimates();
  }

  Future<void> _pickDrop() async {
    final result = await Navigator.of(context).push<({LatLngPoint point, String address})>(
      MaterialPageRoute(
        builder: (_) => MapPickerScreen(title: 'Drop-off location', initial: _drop ?? _pickup ?? const LatLngPoint(lat: 30.05, lng: 31.23)),
      ),
    );
    if (result == null) return;
    setState(() {
      _drop = result.point;
      _dropLabel = result.address.isEmpty ? 'Drop-off pin' : result.address;
    });
    _maybeFetchEstimates();
  }

  Future<void> _maybeFetchEstimates() async {
    final pickup = _pickup;
    final drop = _drop;
    if (pickup == null || drop == null) return;
    setState(() {
      _loadingEstimates = true;
      _error = null;
    });
    try {
      final estimates = await ref.read(fareRepositoryProvider).estimate(pickup: pickup, drop: drop);
      setState(() {
        _estimates = estimates;
        _selectedVehicleTypeId = estimates.isNotEmpty ? estimates.first.vehicleTypeId : null;
      });
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : 'Could not get a fare estimate');
    } finally {
      if (mounted) setState(() => _loadingEstimates = false);
    }
  }

  Future<void> _requestRide() async {
    final pickup = _pickup;
    final drop = _drop;
    final vehicleTypeId = _selectedVehicleTypeId;
    if (pickup == null || drop == null || vehicleTypeId == null) return;
    setState(() {
      _requesting = true;
      _error = null;
    });
    try {
      await ref.read(tripSessionProvider.notifier).requestTrip(
            pickup: pickup,
            drop: drop,
            vehicleTypeId: vehicleTypeId,
            paymentMethod: _paymentMethod,
          );
      if (mounted) context.go('/trip');
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : 'Could not request a ride');
    } finally {
      if (mounted) setState(() => _requesting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Where to?')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.my_location, color: Colors.green),
                  title: Text(_pickupLabel),
                  subtitle: _pickup == null
                      ? const Text('Tap to set pickup')
                      : Text('${_pickup!.lat.toStringAsFixed(5)}, ${_pickup!.lng.toStringAsFixed(5)}'),
                  onTap: _pickPickup,
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.location_pin, color: Colors.red),
                  title: Text(_dropLabel.isEmpty ? 'Set drop-off' : _dropLabel),
                  subtitle: _drop == null
                      ? null
                      : Text('${_drop!.lat.toStringAsFixed(5)}, ${_drop!.lng.toStringAsFixed(5)}'),
                  onTap: _pickDrop,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (_loadingEstimates) const Center(child: CircularProgressIndicator()),
          if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          if (_estimates.isNotEmpty) ...[
            const Text('Choose a ride', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            SizedBox(
              height: 128,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _estimates.length,
                separatorBuilder: (_, __) => const SizedBox(width: 12),
                itemBuilder: (context, index) {
                  final estimate = _estimates[index];
                  final selected = estimate.vehicleTypeId == _selectedVehicleTypeId;
                  return _VehicleCard(
                    estimate: estimate,
                    selected: selected,
                    onTap: () => setState(() => _selectedVehicleTypeId = estimate.vehicleTypeId),
                  );
                },
              ),
            ),
            const SizedBox(height: 16),
            const Text('How will you pay?', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              segments: [
                const ButtonSegment(value: 'cash', label: Text('Cash'), icon: Icon(Icons.money)),
                ButtonSegment(
                  value: 'wallet',
                  label: Text(_walletBalance != null ? 'Wallet ($_walletBalance)' : 'Wallet'),
                  icon: const Icon(Icons.account_balance_wallet),
                ),
                const ButtonSegment(value: 'card', label: Text('Card'), icon: Icon(Icons.credit_card)),
              ],
              selected: {_paymentMethod},
              onSelectionChanged: (selection) => setState(() => _paymentMethod = selection.first),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _requesting ? null : _requestRide,
              child: _requesting
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Request ride'),
            ),
          ],
        ],
      ),
    );
  }
}

class _VehicleCard extends StatelessWidget {
  const _VehicleCard({required this.estimate, required this.selected, required this.onTap});

  final FareEstimate estimate;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 140,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(color: selected ? scheme.primary : scheme.outlineVariant, width: selected ? 2 : 1),
          borderRadius: BorderRadius.circular(12),
          color: selected ? scheme.primaryContainer : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Icon(Icons.directions_car),
            Text(estimate.vehicleTypeName, style: const TextStyle(fontWeight: FontWeight.bold)),
            Text('${estimate.breakdown.total.toStringAsFixed(0)} ${estimate.breakdown.currency}'),
            Text('${(estimate.durationS / 60).round()} min', style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}
