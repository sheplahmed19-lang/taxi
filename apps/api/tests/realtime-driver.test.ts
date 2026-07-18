import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { prisma } from "../src/db/index.js";
import { redis } from "../src/shared/redis.js";
import { createRealtimeServer } from "../src/realtime/index.js";
import { signAccessToken } from "../src/modules/auth/tokens.js";
import { closeDriverOfflineGrace, offlineGraceQueue } from "../src/jobs/driverOfflineGrace.js";
import { findNearbyDrivers, registerDriver, setAvailability } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";

const phone = "+201000022222";
let userId: string;
let vehicleTypeId: string;
let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;

function connectClient(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`${baseUrl}/app`, { auth: { token }, reconnection: false, timeout: 2000 });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

describe("realtime driver events", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "driver" },
    });
    userId = user.id;

    const vehicleType = await prisma.vehicleType.findFirstOrThrow({ where: { name: "Economy" } });
    vehicleTypeId = vehicleType.id;
    await registerDriver(userId, { vehicleTypeId, plate: "SOCK-001" });
    await approveDriver(userId);

    httpServer = createServer();
    createRealtimeServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await closeDriverOfflineGrace();
    await redis.zrem(`drivers:online:${vehicleTypeId}`, userId);
    await redis.del(`driver:${userId}:state`);
    await prisma.vehicle.deleteMany({ where: { driverId: userId } });
    await prisma.driverProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("driver:availability over the socket toggles the driver online", async () => {
    const token = signAccessToken({ id: userId, role: "driver" });
    const socket = await connectClient(token);

    socket.emit("driver:availability", { online: true });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId } });
    expect(profile.online).toBe(true);

    socket.disconnect();
  });

  it("driver:location over the socket updates the GEO index", async () => {
    const token = signAccessToken({ id: userId, role: "driver" });
    const socket = await connectClient(token);
    socket.emit("driver:availability", { online: true });
    await new Promise((resolve) => setTimeout(resolve, 100));

    socket.emit("driver:location", { lat: 30.05, lng: 31.23, heading: 45 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const nearby = await findNearbyDrivers({ lat: 30.05, lng: 31.23 }, vehicleTypeId, 1);
    expect(nearby.find((d) => d.driverId === userId)?.heading).toBe(45);

    socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("disconnecting a driver's last socket schedules an offline-grace job", async () => {
    const token = signAccessToken({ id: userId, role: "driver" });
    const socket = await connectClient(token);
    await new Promise((resolve) => setTimeout(resolve, 100));

    socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const job = await offlineGraceQueue.getJob(userId);
    expect(job).not.toBeNull();

    await job?.remove();
  });

  it("setAvailability(false) still works after a live socket registration", async () => {
    await setAvailability(userId, false);
    const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId } });
    expect(profile.online).toBe(false);
  });
});
