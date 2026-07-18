import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_session.dart';
import '../../core/socket/socket_service.dart';
import '../../shared/models/latlng.dart';
import '../../shared/models/trip.dart';
import '../../shared/models/trip_offer.dart';
import '../../shared/models/trip_status_event.dart';
import 'trip_repository.dart';

class DriverTripState {
  const DriverTripState({
    this.offer,
    this.activeTrip,
    this.pickup,
    this.isResponding = false,
    this.offerLost = false,
  });

  final TripRequestOffer? offer;
  final Trip? activeTrip;
  // Pickup coordinates only ever arrive on the trip:request offer payload
  // (GET /trips/:id doesn't expose them to the driver DTO), so they're
  // captured here at accept-time and carried alongside the active trip.
  final LatLngPoint? pickup;
  final bool isResponding;
  final bool offerLost;

  DriverTripState copyWith({
    TripRequestOffer? offer,
    Trip? activeTrip,
    LatLngPoint? pickup,
    bool? isResponding,
    bool? offerLost,
    bool clearOffer = false,
    bool clearActiveTrip = false,
  }) =>
      DriverTripState(
        offer: clearOffer ? null : (offer ?? this.offer),
        activeTrip: clearActiveTrip ? null : (activeTrip ?? this.activeTrip),
        pickup: clearActiveTrip ? null : (pickup ?? this.pickup),
        isResponding: isResponding ?? this.isResponding,
        offerLost: offerLost ?? this.offerLost,
      );
}

final tripRepositoryProvider = Provider<TripRepository>((ref) => TripRepository(ref.watch(dioClientProvider)));

final driverTripSessionProvider = StateNotifierProvider<DriverTripSessionNotifier, DriverTripState>((ref) {
  return DriverTripSessionNotifier(ref);
});

class DriverTripSessionNotifier extends StateNotifier<DriverTripState> {
  DriverTripSessionNotifier(this._ref) : super(const DriverTripState()) {
    _subscribe();
  }

  final Ref _ref;
  SocketService get _socket => _ref.read(socketServiceProvider);

  void _subscribe() {
    _socket.on('trip:request', (data) {
      if (state.activeTrip != null) return; // already busy — shouldn't happen, but don't clobber an active trip
      final offer = TripRequestOffer.fromJson(Map<String, dynamic>.from(data as Map));
      state = state.copyWith(offer: offer, offerLost: false);
    });

    _socket.on('trip:request_expired', (data) {
      final tripId = (data as Map)['tripId'] as String?;
      if (state.offer?.trip.id != tripId) return;
      state = state.copyWith(clearOffer: true);
    });

    _socket.on('trip:status', (data) {
      final event = TripStatusEvent.fromJson(Map<String, dynamic>.from(data as Map));
      final current = state.activeTrip;
      if (current == null || current.id != event.tripId) return;
      state = state.copyWith(activeTrip: current.copyWith(status: event.status));
    });
  }

  Future<void> respond(bool accept) async {
    final offer = state.offer;
    if (offer == null) return;
    final tripId = offer.trip.id;
    _socket.emit('trip:driver_response', {'tripId': tripId, 'accept': accept});

    if (!accept) {
      state = state.copyWith(clearOffer: true);
      return;
    }

    state = state.copyWith(isResponding: true);
    // The server doesn't ack the accepting driver directly (only the rider
    // gets `trip:accepted`) — first-accept-wins is resolved server-side, so
    // poll the trip once to see whether this driver actually won the offer.
    await Future.delayed(const Duration(milliseconds: 500));
    try {
      final trip = await _ref.read(tripRepositoryProvider).getTrip(tripId);
      final won = trip.status != TripStatus.searching;
      state = won
          ? state.copyWith(
              activeTrip: trip,
              pickup: offer.trip.pickup,
              clearOffer: true,
              isResponding: false,
              offerLost: false,
            )
          : state.copyWith(clearOffer: true, isResponding: false, offerLost: true);
    } catch (_) {
      state = state.copyWith(clearOffer: true, isResponding: false, offerLost: true);
    }
  }

  Future<void> arrive() async {
    final trip = state.activeTrip;
    if (trip == null) return;
    final updated = await _ref.read(tripRepositoryProvider).arriveTrip(trip.id);
    state = state.copyWith(activeTrip: updated);
  }

  Future<void> start(String otp) async {
    final trip = state.activeTrip;
    if (trip == null) return;
    final updated = await _ref.read(tripRepositoryProvider).startTrip(trip.id, otp);
    state = state.copyWith(activeTrip: updated);
  }

  Future<void> complete() async {
    final trip = state.activeTrip;
    if (trip == null) return;
    final updated = await _ref.read(tripRepositoryProvider).completeTrip(trip.id);
    state = state.copyWith(activeTrip: updated);
  }

  Future<void> cancel(String reason) async {
    final trip = state.activeTrip;
    if (trip == null) return;
    final updated = await _ref.read(tripRepositoryProvider).cancelTrip(trip.id, reason);
    state = state.copyWith(activeTrip: updated);
  }

  Future<void> rate(int stars, {String? review}) async {
    final trip = state.activeTrip;
    if (trip == null) return;
    await _ref.read(tripRepositoryProvider).rateTrip(trip.id, stars, review: review);
  }

  void dismissOfferLost() => state = state.copyWith(offerLost: false);

  void finishTrip() => state = state.copyWith(clearActiveTrip: true);
}
