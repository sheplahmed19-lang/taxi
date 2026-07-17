import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { logger } from "../shared/logger.js";

/**
 * Socket.IO server bootstrap. Namespaces/rooms/events per docs/socket-events.md.
 * JWT handshake auth + Redis socket<->user mapping land in Phase 0.5.
 */
export function createRealtimeServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  const appNamespace = io.of("/app");
  appNamespace.on("connection", (socket) => {
    logger.debug({ socketId: socket.id }, "socket connected on /app");
  });

  const adminNamespace = io.of("/admin");
  adminNamespace.on("connection", (socket) => {
    logger.debug({ socketId: socket.id }, "socket connected on /admin");
  });

  io.of("/public");

  return io;
}
