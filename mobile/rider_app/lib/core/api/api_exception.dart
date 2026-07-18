/// Thrown for any `{success:false,error:{code,message}}` API response
/// (see CLAUDE.md rule 8) or for a network-level failure.
class ApiException implements Exception {
  const ApiException(this.message, {this.code});

  final String message;
  final String? code;

  @override
  String toString() => 'ApiException($code): $message';
}
