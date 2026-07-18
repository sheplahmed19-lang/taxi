import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/auth/auth_session.dart';
import '../features/auth/otp_login_screen.dart';
import '../features/booking/booking_screen.dart';
import '../features/home_map/home_map_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/trip/active_trip_screen.dart';

/// Bridges riverpod state changes into a [Listenable] GoRouter can watch,
/// so `redirect` re-runs whenever auth state changes without recreating
/// the whole router (which would otherwise reset the navigation stack).
class _RouterRefreshNotifier extends ChangeNotifier {
  _RouterRefreshNotifier(Ref ref) {
    ref.listen(authSessionProvider, (_, __) => notifyListeners());
  }
}

final riderRouterProvider = Provider<GoRouter>((ref) {
  final refresh = _RouterRefreshNotifier(ref);
  return GoRouter(
    initialLocation: '/onboarding',
    refreshListenable: refresh,
    redirect: (context, state) {
      final session = ref.read(authSessionProvider);
      final path = state.matchedLocation;
      if (!session.bootstrapped) return null;

      final isAuthRoute = path == '/onboarding' || path == '/login';
      if (!session.isAuthenticated && !isAuthRoute) return '/login';
      if (session.isAuthenticated && isAuthRoute) return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/onboarding', builder: (context, state) => const OnboardingScreen()),
      GoRoute(path: '/login', builder: (context, state) => const OtpLoginScreen()),
      GoRoute(path: '/home', builder: (context, state) => const HomeMapScreen()),
      GoRoute(path: '/booking', builder: (context, state) => const BookingScreen()),
      GoRoute(path: '/trip', builder: (context, state) => const ActiveTripScreen()),
    ],
  );
});
