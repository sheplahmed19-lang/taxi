import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { prisma } from "../src/db/index.js";
import { redis } from "../src/shared/redis.js";
import { createRealtimeServer } from "../src/realtime/index.js";
import { signAccessToken } from "../src/modules/auth/tokens.js";
import { closeDriverOfflineGrace } from "../src/jobs/driverOfflineGrace.js";
import { recordLocation, registerDriver, setAvailability } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let vehicleTypeId: string;
let riderId: string;
let driverId: string;
let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;
const tripIds: string[] = [];

function connectAdmin(): Promise<ClientSocket> {
  const token = signAccessToken({ id: "admin-test", role: "admin" });
  return new Promise((resolve, reject) => {
    const socket = ioClient(`${baseUrl}/admin`, { auth: { token }, reconnection: false, timeout: 2000 });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

function connectDriver(): Promise<ClientSocket> {
  const token = signAccessToken({ id: driverId, role: "driver" });
  return new Promise((resolve, reject) => {
    const socket = ioClient(`${baseUrl}/app`, { auth: { token }, reconnection: false, timeout: 2000 });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

async function waitForEvent<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe("admin live ops — socket events", () => {
  beforeAll(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `LiveSocketTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeId = vt.id;

    const rider = await prisma.user.create({ data: { phone: `+20100007${Date.now()}`.slice(0, 14), role: "rider" } });
    riderId = rider.id;
    const driver = await prisma.user.create({
      data: { phone: `+20100008${Date.now()}`.slice(0, 14), role: "driver", wallet: { create: { balance: 0 } } },
    });
    driverId = driver.id;
    await registerDriver(driverId, { vehicleTypeId, plate: `SOCKADM-${Date.now()}` });
    await approveDriver(driverId);
    await setAvailability(driverId, true);
    await recordLocation(driverId, { lat: 30.0505, lng: 31.2305 });

    httpServer = createServer();
    createRealtimeServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await closeDispatchTimeout();
    await closeDriverOfflineGrace();
    await redis.zrem(`drivers:online:${vehicleTypeId}`, driverId);
    await redis.del(`driver:${driverId}:state`);
    for (const id of tripIds) {
      await prisma.tripLocation.deleteMany({ where: { tripId: id } });
      await prisma.ledgerEntry.deleteMany({ where: { tripId: id } });
      await prisma.trip.deleteMany({ where: { id } });
    }
    await prisma.oweAmount.deleteMany({ where: { driverId } });
    await prisma.vehicle.deleteMany({ where: { driverId } });
    await prisma.driverProfile.deleteMany({ where: { userId: driverId } });
    await prisma.user.deleteMany({ where: { id: { in: [riderId, driverId] } } });
    await prisma.vehicleType.delete({ where: { id: vehicleTypeId } });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("a non-admin/staff/dispatcher role is rejected on the /admin namespace", async () => {
    const token = signAccessToken({ id: riderId, role: "rider" });
    const socket = ioClient(`${baseUrl}/admin`, { auth: { token }, reconnection: false, timeout: 2000 });
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => reject(new Error("should not have connected")));
      socket.on("connect_error", () => resolve());
    });
  });

  it("driver:availability and driver:location relay to admin:driver_status / admin:driver_location", async () => {
    const admin = await connectAdmin();
    const driver = await connectDriver();

    const statusPromise = waitForEvent<{ driverId: string; online: boolean }>(admin, "admin:driver_status");
    driver.emit("driver:availability", { online: true });
    const status = await statusPromise;
    expect(status.driverId).toBe(driverId);
    expect(status.online).toBe(true);

    // Stays within dispatch radius of `pickup` — the next test dispatches a real trip to this driver.
    const locationPromise = waitForEvent<{ driverId: string; lat: number; lng: number }>(admin, "admin:driver_location");
    driver.emit("driver:location", { lat: 30.0507, lng: 31.2307, heading: 10 });
    const location = await locationPromise;
    expect(location.driverId).toBe(driverId);
    expect(location.lat).toBeCloseTo(30.0507, 3);

    driver.disconnect();
    admin.disconnect();
  });

  it("requesting and accepting a trip relays admin:trip_new / admin:trip_status", async () => {
    const admin = await connectAdmin();

    const newTripPromise = waitForEvent<{ tripId: string; riderId: string; status: string }>(admin, "admin:trip_new");
    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripIds.push(trip.id);
    const newTripEvent = await newTripPromise;
    expect(newTripEvent.tripId).toBe(trip.id);
    expect(newTripEvent.riderId).toBe(riderId);
    expect(newTripEvent.status).toBe("requested");

    const statusPromise = waitForEvent<{ tripId: string; status: string; driverId: string | null }>(
      admin,
      "admin:trip_status",
    );
    await handleDriverResponse(trip.id, driverId, true);
    const statusEvent = await statusPromise;
    expect(statusEvent.tripId).toBe(trip.id);
    expect(statusEvent.status).toBe("accepted");
    expect(statusEvent.driverId).toBe(driverId);

    admin.disconnect();
  });
});
