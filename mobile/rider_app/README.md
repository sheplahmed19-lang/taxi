# rider_app

Flutter rider app. This directory currently contains only the Dart source
skeleton (`lib/`, `pubspec.yaml`, `analysis_options.yaml`) — the native
`android/`/`ios/` project folders are **not** generated yet because the
Flutter SDK isn't available in the environment that created this scaffold.

## First-time setup (run locally, once Flutter is installed)

```bash
cd mobile/rider_app
flutter create . --org com.rideplatform --project-name rider_app
cp .env.example .env   # fill in API_BASE_URL / keys
flutter pub get
dart run build_runner build --delete-conflicting-outputs   # generates freezed/json_serializable code
flutter run
```

`flutter create .` will scaffold `android/`, `ios/`, and platform
boilerplate into this existing `lib/`/`pubspec.yaml` without overwriting
them. See `docs/plan.md` Section 6 for the full folder convention and
Phase 0.6 / 1.6 for what to build next.
