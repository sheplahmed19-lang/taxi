import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import 'app/app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: '.env');

  final publishableKey = dotenv.env['STRIPE_PUBLISHABLE_KEY'];
  if (publishableKey != null && publishableKey.isNotEmpty) {
    Stripe.publishableKey = publishableKey;
    await Stripe.instance.applySettings();
  }

  runApp(const ProviderScope(child: RiderApp()));
}
