import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { logger } from "../shared/logger.js";
import { redis } from "../shared/redis.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";
import type { AuthUser } from "../middleware/auth.js";
import { recordLocation, setAvailability, type DriverLocationInput } from "../modules/drivers/service.js";
import { scheduleOfflineGraceCheck } from "../jobs/driverOfflineGrace.js";

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

    if (user.role === "driver") {
      socket.on("driver:availability", (payload: { online: boolean }) => {
        setAvailability(user.id, Boolean(payload?.online)).catch((err: unknown) => {
          logger.warn({ err, driverId: user.id }, "driver:availability failed");
        });
      });

      socket.on("driver:location", (payload: DriverLocationInput) => {
        recordLocation(user.id, payload).catch((err: unknown) => {
          logger.warn({ err, driverId: user.id }, "driver:location failed");
        });
      });

      socket.on("trip:driver_response", (payload: { tripId: string; accept: boolean }) => {
        // Dynamic import: dispatch/service.ts imports emitToUser from this
        // file, so a static top-level import here would create a cycle.
        import("../modules/dispatch/service.js")
          .then(({ handleDriverResponse }) => handleDriverResponse(payload?.tripId, user.id, Boolean(payload?.accept)))
          .catch((err: unknown) => {
            logger.warn({ err, driverId: user.id }, "trip:driver_response failed");
          });
      });
    }

    socket.on("disconnect", () => {
      void (async () => {
        await redis.srem(userSocketsKey(user.id), socket.id);
        await redis.del(socketKey(socket.id));

        if (user.role === "driver") {
          const remaining = await redis.scard(userSocketsKey(user.id));
          if (remaining === 0) {
            await scheduleOfflineGraceCheck(user.id);
          }
        }
      })();
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
