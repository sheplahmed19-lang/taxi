import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/onboarding/onboarding_screen.dart';
import '../features/auth/otp_login_screen.dart';
import '../features/home_map/home_map_screen.dart';

final riderRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/onboarding',
    routes: [
      GoRoute(
        path: '/onboarding',
        builder: (context, state) => const OnboardingScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const OtpLoginScreen(),
      ),
      GoRoute(
        path: '/home',
        builder: (context, state) => const HomeMapScreen(),
      ),
    ],
  );
});
