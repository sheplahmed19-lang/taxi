import 'package:flutter/material.dart';

/// Phone entry -> OTP verification -> driver registration (personal info +
/// vehicle info + document upload). Wired to /auth/otp/* and /drivers/register
/// in Phase 0.3/0.4/0.6.
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
