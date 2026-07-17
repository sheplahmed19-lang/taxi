import 'package:flutter/material.dart';

/// Phone entry -> OTP verification -> profile completion.
/// Wired to POST /auth/otp/request and /auth/otp/verify in Phase 0.3/0.6.
class OtpLoginScreen extends StatelessWidget {
  const OtpLoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign in')),
      body: const Padding(
        padding: EdgeInsets.all(16),
        child: Text('Phone OTP login form goes here (Phase 0.6).'),
      ),
    );
  }
}
