import 'package:flutter/material.dart';

/// Online/offline toggle + foreground location service.
/// Full ride flow (incoming request, navigate, OTP, complete) in Phase 1.7.
class AvailabilityScreen extends StatelessWidget {
  const AvailabilityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Availability toggle — Phase 1.7')),
    );
  }
}
