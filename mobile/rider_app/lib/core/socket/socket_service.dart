import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

/// Wraps the /app namespace socket connection. Event payload types should
/// mirror docs/socket-events.md — keep both in sync.
class SocketService {
  io.Socket? _socket;

  void connect(String accessToken) {
    _socket = io.io(
      dotenv.env['SOCKET_URL'],
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setPath('/socket.io')
          .setAuth({'token': accessToken})
          .build(),
    );
  }

  void disconnect() => _socket?.disconnect();
}
