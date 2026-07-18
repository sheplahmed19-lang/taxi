import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

/// Wraps the `/app` namespace socket connection. Event payload shapes must
/// mirror docs/socket-events.md — keep both in sync.
class SocketService {
  io.Socket? _socket;

  bool get isConnected => _socket?.connected ?? false;

  void connect(String accessToken) {
    if (_socket != null) {
      disconnect();
    }
    final base = dotenv.env['SOCKET_URL'] ?? '';
    _socket = io.io(
      '$base/app',
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setPath('/socket.io')
          .setAuth({'token': accessToken})
          .enableReconnection()
          .build(),
    );
    _socket?.connect();
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
  }

  void on(String event, void Function(dynamic) handler) => _socket?.on(event, handler);

  void off(String event) => _socket?.off(event);

  void emit(String event, Map<String, dynamic> data) => _socket?.emit(event, data);
}
