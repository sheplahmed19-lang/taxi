import 'package:firebase_messaging/firebase_messaging.dart';

/// FCM setup + local notification display. Wired up in Phase 0.5/0.6.
class PushService {
  final _messaging = FirebaseMessaging.instance;

  Future<String?> getToken() => _messaging.getToken();
}
