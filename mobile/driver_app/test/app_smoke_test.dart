import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:driver_app/app/app.dart';

void main() {
  setUpAll(() {
    dotenv.testLoad(fileInput: 'API_BASE_URL=http://localhost:4000/api/v1\nSOCKET_URL=http://localhost:4000\n');
  });

  testWidgets('app boots to the onboarding screen when logged out', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: DriverApp()));
    await tester.pump();

    expect(find.text('Ride — Driver'), findsOneWidget);
    expect(find.text('Get started'), findsOneWidget);
  });
}
