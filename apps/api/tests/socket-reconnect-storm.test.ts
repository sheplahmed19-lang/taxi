import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { prisma } from "../src/db/index.js";
import { redis } from "../src/shared/redis.js";
import { createRealtimeServer } from "../src/realtime/index.js";
import { signAccessToken } from "../src/modules/auth/tokens.js";
import { closeDriverOfflineGrace, offlineGraceQueue } from "../src/jobs/driverOfflineGrace.js";
import { registerDriver, setAvailability } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";

/**
 * Phase 5.1 chaos test: real Socket.IO connect/disconnect churn against the
 * actual createRealtimeServer, not just a direct call into the offline-grace
 * job (driver-offline-grace.test.ts already covers that in isolation). This
 * exercises the full path — handshake, the disconnect handler's
 * userSocketsKey bookkeeping, and scheduleOfflineGraceCheck's BullMQ
 * dedupe-by-jobId — under rapid reconnect churn and a concurrent connection
 * burst, the two chaos scenarios docs/plan.md's 5.1 calls out.
 */
const suffix = Date.now();
let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;
let vehicleTypeId: string;
const userIds: string[] = [];

function connectClient(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`${baseUrl}/app`, { auth: { token }, reconnection: false, timeout: 3000 });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

function disconnectAndWait(socket: ClientSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.on("disconnect", () => resolve());
    socket.disconnect();
  });
}

async function makeDriver(phone: string, plate: string): Promise<string> {
  const user = await prisma.user.upsert({ where: { phone }, update: {}, create: { phone, role: "driver" } });
  await registerDriver(user.id, { vehicleTypeId, plate });
  await approveDriver(user.id);
  userIds.push(user.id);
  return user.id;
}

describe("socket reconnect storm handling (Phase 5.1 chaos)", () => {
  beforeAll(async () => {
    const vehicleType = await prisma.vehicleType.findFirstOrThrow({ where: { name: "Economy" } });
    vehicleTypeId = vehicleType.id;

    httpServer = createServer();
    createRealtimeServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await closeDriverOfflineGrace();
    for (const id of userIds) {
      await redis.zrem(`drivers:online:${vehicleTypeId}`, id);
      await redis.del(`driver:${id}:state`, `user:${id}:sockets`);
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("survives rapid sequential connect/disconnect churn without leaking socket-set state or stacking offline-grace jobs", async () => {
    const driverId = await makeDriver(`+2019005${suffix}`.slice(0, 15), `STORM-A-${suffix}`);
    await setAvailability(driverId, true);
    const token = signAccessToken({ id: driverId, role: "driver" });

    const CYCLES = 25;
    for (let i = 0; i < CYCLES; i++) {
      const socket = await connectClient(token);
      await disconnectAndWait(socket);
    }

    // Every cycle's disconnect handler ran to completion (socket.io fires
    // the client-side "disconnect" event before the server has necessarily
    // finished its own async cleanup) — give the last one a moment.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const remainingSockets = await redis.scard(`user:${driverId}:sockets`);
    expect(remainingSockets).toBe(0);

    // scheduleOfflineGraceCheck uses a fixed jobId (the driverId), so 25
    // rapid disconnects should still leave at most one pending grace job for
    // this driver, not 25 stacked ones.
    const job = await offlineGraceQueue.getJob(driverId);
    expect(job).not.toBeNull();
    await job?.remove();
  });

  it("does not flip a driver offline if they reconnect before the grace period elapses, even after churn", async () => {
    const driverId = await makeDriver(`+2019006${suffix}`.slice(0, 15), `STORM-B-${suffix}`);
    await setAvailability(driverId, true);
    const token = signAccessToken({ id: driverId, role: "driver" });

    // A few churn cycles, then reconnect and stay connected.
    for (let i = 0; i < 5; i++) {
      const socket = await connectClient(token);
      await disconnectAndWait(socket);
    }
    const finalSocket = await connectClient(token);

    // Directly fire a short-delay grace check (mirrors what the last
    // disconnect's handler already scheduled, just without waiting out the
    // real 60s default) — the driver has an active socket, so it must
    // no-op rather than marking them offline.
    const { scheduleOfflineGraceCheck } = await import("../src/jobs/driverOfflineGrace.js");
    await scheduleOfflineGraceCheck(driverId, 100);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId: driverId } });
    expect(profile.online).toBe(true);

    finalSocket.disconnect();
  });

  it("handles a burst of many concurrent connections across different drivers without dropping or erroring any of them", async () => {
    const BURST_SIZE = 40; // scaled down from the plan's 500-driver target — see docs/loadtest/README.md
    // `i` must survive the 15-char phone-length cap or every generated
    // number collapses to the same value once truncated.
    const phones = Array.from(
      { length: BURST_SIZE },
      (_, i) => `+2019007${String(suffix).slice(-4)}${String(i).padStart(3, "0")}`,
    );
    const driverIds = await Promise.all(phones.map((phone, i) => makeDriver(phone, `STORM-C-${suffix}-${i}`)));

    const tokens = driverIds.map((id) => signAccessToken({ id, role: "driver" }));
    const sockets = await Promise.all(tokens.map((token) => connectClient(token)));

    expect(sockets).toHaveLength(BURST_SIZE);
    expect(sockets.every((s) => s.connected)).toBe(true);

    await Promise.all(sockets.map((s) => disconnectAndWait(s)));
    await new Promise((resolve) => setTimeout(resolve, 300));

    const remainingCounts = await Promise.all(driverIds.map((id) => redis.scard(`user:${id}:sockets`)));
    expect(remainingCounts.every((count) => count === 0)).toBe(true);
  });
});
