import 'package:flutter/material.dart';

/// Shared design tokens. Expand with a full type scale / spacing system
/// as screens are built out (Phase 0.6+).
ThemeData buildAppTheme() {
  const seed = Color(0xFF7C3AED);
  return ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: seed),
    useMaterial3: true,
  );
}
