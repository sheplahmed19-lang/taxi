import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_session.dart';
import '../../core/api/dio_client.dart';

class RidePaymentIntent {
  const RidePaymentIntent({required this.paymentId, this.clientSecret, this.redirectUrl});

  final String paymentId;
  final String? clientSecret;
  final String? redirectUrl;
}

final paymentsRepositoryProvider = Provider<PaymentsRepository>((ref) => PaymentsRepository(ref.watch(dioClientProvider)));

class PaymentsRepository {
  PaymentsRepository(this._client);

  final DioClient _client;

  Future<RidePaymentIntent> initRidePayment(String tripId) => _client.unwrap(
        () => _client.dio.post('/payments/ride/$tripId/init'),
        (data) => RidePaymentIntent(
          paymentId: (data as Map<String, dynamic>)['paymentId'] as String,
          clientSecret: data['clientSecret'] as String?,
          redirectUrl: data['redirectUrl'] as String?,
        ),
      );
}
