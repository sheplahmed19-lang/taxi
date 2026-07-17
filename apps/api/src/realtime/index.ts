import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { logger } from "../shared/logger.js";
import { redis } from "../shared/redis.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";
import type { AuthUser } from "../middleware/auth.js";

/**
 * Socket.IO server bootstrap. Namespaces/rooms/events per docs/socket-events.md
 * — keep that file in sync whenever an event or room changes (CLAUDE.md rule 9).
 */
let io: Server | null = null;

function socketKey(socketId: string): string {
  return `socket:${socketId}`;
}

function userSocketsKey(userId: string): string {
  return `user:${userId}:sockets`;
}

async function authenticate(socket: Socket): Promise<AuthUser> {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    throw new Error("Missing token");
  }
  const payload = verifyAccessToken(token);
  return { id: payload.id, role: payload.role };
}

export function createRealtimeServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  const appNamespace = io.of("/app");
  appNamespace.use((socket, next) => {
    authenticate(socket)
      .then((user) => {
        socket.data.user = user;
        next();
      })
      .catch(() => next(new Error("unauthorized")));
  });
  appNamespace.on("connection", (socket) => {
    const user = socket.data.user as AuthUser;

    void socket.join(`user:${user.id}`);
    void redis.sadd(userSocketsKey(user.id), socket.id);
    void redis.set(socketKey(socket.id), user.id);
    logger.debug({ socketId: socket.id, userId: user.id }, "socket connected on /app");

    // Trip rooms (trip:{id}) are joined once the trips module exists — Phase 1.4/1.5.

    socket.on("disconnect", () => {
      void redis.srem(userSocketsKey(user.id), socket.id);
      void redis.del(socketKey(socket.id));
    });
  });

  const adminNamespace = io.of("/admin");
  adminNamespace.use((socket, next) => {
    authenticate(socket)
      .then((user) => {
        if (!["admin", "staff", "dispatcher"].includes(user.role)) {
          throw new Error("forbidden");
        }
        socket.data.user = user;
        next();
      })
      .catch(() => next(new Error("unauthorized")));
  });
  adminNamespace.on("connection", (socket) => {
    void socket.join("admin:live");
    logger.debug({ socketId: socket.id }, "socket connected on /admin");
  });

  // Token-scoped read-only trip tracking for logged-out browsers — Phase 3.4.
  io.of("/public");

  return io;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.of("/app").to(`user:${userId}`).emit(event, payload);
}

export function emitToTrip(tripId: string, event: string, payload: unknown): void {
  io?.of("/app").to(`trip:${tripId}`).emit(event, payload);
}

export function emitToAdmins(event: string, payload: unknown): void {
  io?.of("/admin").to("admin:live").emit(event, payload);
}
