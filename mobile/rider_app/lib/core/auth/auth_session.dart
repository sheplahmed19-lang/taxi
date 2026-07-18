import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../shared/models/auth_user.dart';
import '../api/dio_client.dart';
import '../socket/socket_service.dart';
import '../storage/secure_storage.dart';
import '../users/users_repository.dart';
import 'auth_repository.dart';

class AuthSessionState {
  const AuthSessionState({this.user, this.accessToken, this.bootstrapped = false});

  final AuthUser? user;
  final String? accessToken;
  final bool bootstrapped;

  bool get isAuthenticated => user != null && accessToken != null;

  AuthSessionState copyWith({AuthUser? user, String? accessToken, bool? bootstrapped}) => AuthSessionState(
        user: user ?? this.user,
        accessToken: accessToken ?? this.accessToken,
        bootstrapped: bootstrapped ?? this.bootstrapped,
      );
}

final secureStorageProvider = Provider<SecureStorage>((ref) => SecureStorage());

final socketServiceProvider = Provider<SocketService>((ref) => SocketService());

final dioClientProvider = Provider<DioClient>((ref) {
  return DioClient(
    ref.watch(secureStorageProvider),
    onSessionExpired: () => ref.read(authSessionProvider.notifier).logout(),
  );
});

final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository(ref.watch(dioClientProvider)));

final usersRepositoryProvider = Provider<UsersRepository>((ref) => UsersRepository(ref.watch(dioClientProvider)));

final authSessionProvider = StateNotifierProvider<AuthSessionNotifier, AuthSessionState>((ref) {
  return AuthSessionNotifier(ref);
});

/// Rider role is hardcoded here — this is the rider app; the driver app's
/// equivalent notifier passes 'driver' instead.
class AuthSessionNotifier extends StateNotifier<AuthSessionState> {
  AuthSessionNotifier(this._ref) : super(const AuthSessionState()) {
    _bootstrap();
  }

  final Ref _ref;
  static const role = 'rider';

  Future<void> _bootstrap() async {
    final storage = _ref.read(secureStorageProvider);
    final token = await storage.readAccessToken();
    if (token == null) {
      state = state.copyWith(bootstrapped: true);
      return;
    }
    try {
      final user = await _ref.read(usersRepositoryProvider).getMe();
      _ref.read(socketServiceProvider).connect(token);
      state = state.copyWith(user: user, accessToken: token, bootstrapped: true);
    } catch (_) {
      // Stored token is stale/invalid (and the refresh interceptor already
      // tried and failed) — fall back to a logged-out state.
      await storage.clear();
      state = state.copyWith(bootstrapped: true);
    }
  }

  Future<void> requestOtp(String phone) => _ref.read(authRepositoryProvider).requestOtp(phone);

  Future<void> verifyOtp(String phone, String otp) async {
    final result = await _ref.read(authRepositoryProvider).verifyOtp(phone, otp, role);
    await _ref.read(secureStorageProvider).writeTokens(
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        );
    _ref.read(socketServiceProvider).connect(result.accessToken);
    state = state.copyWith(user: result.user, accessToken: result.accessToken);
  }

  Future<void> logout() async {
    _ref.read(socketServiceProvider).disconnect();
    await _ref.read(secureStorageProvider).clear();
    state = const AuthSessionState(bootstrapped: true);
  }
}
