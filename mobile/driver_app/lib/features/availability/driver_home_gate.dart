import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_session.dart';
import '../../shared/models/driver_profile.dart';
import '../registration/driver_registration_screen.dart';
import 'availability_screen.dart';

/// Decides which screen to show right after login: register a vehicle,
/// wait for admin approval, show a rejection reason, or (once approved)
/// the real availability toggle.
class DriverHomeGate extends ConsumerStatefulWidget {
  const DriverHomeGate({super.key});

  @override
  ConsumerState<DriverHomeGate> createState() => _DriverHomeGateState();
}

class _DriverHomeGateState extends ConsumerState<DriverHomeGate> {
  late Future<DriverProfile?> _profileFuture;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _profileFuture = ref.read(driversRepositoryProvider).getMyProfile();
  }

  void _refresh() => setState(_load);

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<DriverProfile?>(
      future: _profileFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (snapshot.hasError) {
          final message = snapshot.error is ApiException ? (snapshot.error as ApiException).message : 'Something went wrong';
          return Scaffold(
            body: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(message),
                  const SizedBox(height: 16),
                  ElevatedButton(onPressed: _refresh, child: const Text('Retry')),
                ],
              ),
            ),
          );
        }

        final profile = snapshot.data;
        if (profile == null) {
          return DriverRegistrationScreen(onRegistered: _refresh);
        }

        switch (profile.verificationStatus) {
          case VerificationStatus.approved:
            return AvailabilityScreen(profile: profile);
          case VerificationStatus.rejected:
            return _RejectedView(reason: profile.rejectionReason, onRetry: _refresh);
          default:
            return _PendingView(onRefresh: _refresh);
        }
      },
    );
  }
}

class _PendingView extends ConsumerWidget {
  const _PendingView({required this.onRefresh});
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(icon: const Icon(Icons.logout), onPressed: () => ref.read(authSessionProvider.notifier).logout()),
        ],
      ),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.hourglass_top, size: 48),
            const SizedBox(height: 16),
            const Text('Your documents are under review'),
            const SizedBox(height: 24),
            OutlinedButton(onPressed: onRefresh, child: const Text('Check again')),
          ],
        ),
      ),
    );
  }
}

class _RejectedView extends ConsumerWidget {
  const _RejectedView({required this.reason, required this.onRetry});
  final String? reason;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(icon: const Icon(Icons.logout), onPressed: () => ref.read(authSessionProvider.notifier).logout()),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48, color: Colors.red),
              const SizedBox(height: 16),
              const Text('Your application was rejected'),
              if (reason != null) ...[
                const SizedBox(height: 8),
                Text(reason!, textAlign: TextAlign.center),
              ],
              const SizedBox(height: 24),
              OutlinedButton(onPressed: onRetry, child: const Text('Check again')),
            ],
          ),
        ),
      ),
    );
  }
}
