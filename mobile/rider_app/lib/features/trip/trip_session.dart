import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_session.dart';
import '../../core/socket/socket_service.dart';
import '../../shared/models/driver_info.dart';
import '../../shared/models/latlng.dart';
import '../../shared/models/trip.dart';
import '../../shared/models/trip_status_event.dart';
import 'trip_repository.dart';

class TripSessionState {
  const TripSessionState({
    this.trip,
    this.driver,
    this.vehicle,
    this.eta,
    this.driverLocation,
    this.isRequesting = false,
    this.noDriversFound = false,
    this.error,
  });

  final Trip? trip;
  final DriverInfo? driver;
  final VehicleInfo? vehicle;
  final int? eta;
  final LatLngPoint? driverLocation;
  final bool isRequesting;
  final bool noDriversFound;
  final String? error;

  bool get hasActiveTrip => trip != null && trip!.isActive;

  TripSessionState copyWith({
    Trip? trip,
    DriverInfo? driver,
    VehicleInfo? vehicle,
    int? eta,
    LatLngPoint? driverLocation,
    bool? isRequesting,
    bool? noDriversFound,
    String? error,
    bool clearError = false,
  }) =>
      TripSessionState(
        trip: trip ?? this.trip,
        driver: driver ?? this.driver,
        vehicle: vehicle ?? this.vehicle,
        eta: eta ?? this.eta,
        driverLocation: driverLocation ?? this.driverLocation,
        isRequesting: isRequesting ?? this.isRequesting,
        noDriversFound: noDriversFound ?? this.noDriversFound,
        error: clearError ? null : (error ?? this.error),
      );
}

final tripRepositoryProvider = Provider<TripRepository>((ref) => TripRepository(ref.watch(dioClientProvider)));

final tripSessionProvider = StateNotifierProvider<TripSessionNotifier, TripSessionState>((ref) {
  return TripSessionNotifier(ref);
});

class TripSessionNotifier extends StateNotifier<TripSessionState> {
  TripSessionNotifier(this._ref) : super(const TripSessionState()) {
    _subscribe();
  }

  final Ref _ref;
  SocketService get _socket => _ref.read(socketServiceProvider);

  void _subscribe() {
    _socket.on('trip:accepted', (data) {
      final accepted = TripAccepted.fromJson(Map<String, dynamic>.from(data as Map));
      final current = state.trip;
      if (current == null || current.id != accepted.trip.id) return;
      state = state.copyWith(
        trip: current.copyWith(status: accepted.trip.status, otp: accepted.trip.otp),
        driver: accepted.driver,
        vehicle: accepted.vehicle,
        eta: accepted.eta,
      );
    });

    _socket.on('trip:status', (data) {
      final event = TripStatusEvent.fromJson(Map<String, dynamic>.from(data as Map));
      final current = state.trip;
      if (current == null || current.id != event.tripId) return;

      if (event.status == TripStatus.completed || event.status == TripStatus.paid) {
        // paymentMethod can change server-side without the rider doing
        // anything (e.g. a wallet payment falling back to cash for
        // insufficient balance), so re-fetch the authoritative trip rather
        // than trying to patch individual fields from the socket payload.
        _refetchTrip(event.tripId);
        return;
      }

      final payload = event.payload;
      state = state.copyWith(
        trip: current.copyWith(
          status: event.status,
          fareTotal: (payload?['fareTotal'] as num?)?.toInt() ?? current.fareTotal,
        ),
      );
    });

    _socket.on('trip:driver_location', (data) {
      final event = DriverLocationEvent.fromJson(Map<String, dynamic>.from(data as Map));
      if (state.trip == null) return;
      state = state.copyWith(driverLocation: LatLngPoint(lat: event.lat, lng: event.lng), eta: event.eta);
    });

    _socket.on('trip:no_drivers', (data) {
      final current = state.trip;
      if (current == null) return;
      state = state.copyWith(noDriversFound: true, trip: current.copyWith(status: TripStatus.noDriversFound));
    });
  }

  Future<void> _refetchTrip(String tripId) async {
    try {
      final trip = await _ref.read(tripRepositoryProvider).getTrip(tripId);
      if (state.trip?.id != tripId) return; // session moved on (e.g. reset()) while this was in flight
      state = state.copyWith(trip: trip);
    } catch (_) {
      // Best-effort — the trip stays at its last known state, which the UI already handles.
    }
  }

  Future<void> requestTrip({
    required LatLngPoint pickup,
    required LatLngPoint drop,
    required String vehicleTypeId,
    required String paymentMethod,
  }) async {
    state = state.copyWith(isRequesting: true, clearError: true, noDriversFound: false);
    try {
      final trip = await _ref.read(tripRepositoryProvider).requestTrip(
            pickup: pickup,
            drop: drop,
            vehicleTypeId: vehicleTypeId,
            paymentMethod: paymentMethod,
          );
      state = TripSessionState(trip: trip, isRequesting: false);
    } catch (e) {
      state = state.copyWith(isRequesting: false, error: e.toString());
      rethrow;
    }
  }

  Future<void> cancelTrip(String reason) async {
    final trip = state.trip;
    if (trip == null) return;
    final updated = await _ref.read(tripRepositoryProvider).cancelTrip(trip.id, reason);
    state = state.copyWith(trip: updated);
  }

  Future<void> rateTrip(int stars, {String? review}) async {
    final trip = state.trip;
    if (trip == null) return;
    await _ref.read(tripRepositoryProvider).rateTrip(trip.id, stars, review: review);
  }

  /// Back to the home map after a completed/cancelled trip is rated/dismissed.
  void reset() {
    state = const TripSessionState();
  }
}
