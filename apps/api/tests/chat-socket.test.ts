import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { prisma } from "../src/db/index.js";
import { createRealtimeServer } from "../src/realtime/index.js";
import { signAccessToken } from "../src/modules/auth/tokens.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let vehicleTypeId: string;
let riderId: string;
let driverId: string;
let tripId: string;
let httpServer: ReturnType<typeof createServer>;
let baseUrl: string;

function connectApp(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`${baseUrl}/app`, { auth: { token }, reconnection: false, timeout: 2000 });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

describe("chat over the /app socket", () => {
  beforeAll(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `ChatSocketTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeId = vt.id;

    const rider = await prisma.user.upsert({
      where: { phone: "+201000022301" },
      update: {},
      create: { phone: "+201000022301", role: "rider", name: "Socket Rider" },
    });
    riderId = rider.id;

    const driver = await prisma.user.upsert({
      where: { phone: "+201000022311" },
      update: {},
      create: { phone: "+201000022311", role: "driver", name: "Socket Driver", wallet: { create: { balance: 0 } } },
    });
    driverId = driver.id;
    await registerDriver(driverId, { vehicleTypeId, plate: "CHATSOCK-1" });
    await approveDriver(driverId);
    await setAvailability(driverId, true);
    await recordLocation(driverId, { lat: 30.0505, lng: 31.2305 });

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripId = trip.id;

    httpServer = createServer();
    createRealtimeServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await closeDispatchTimeout();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.chatMessage.deleteMany({ where: { tripId } });
    await prisma.notification.deleteMany({ where: { userId: { in: [riderId, driverId] } } });
    await prisma.ledgerEntry.deleteMany({ where: { tripId } });
    await prisma.trip.delete({ where: { id: tripId } });
    await prisma.oweAmount.deleteMany({ where: { driverId } });
    await prisma.vehicle.deleteMany({ where: { driverId } });
    await prisma.driverProfile.deleteMany({ where: { userId: driverId } });
    await prisma.user.deleteMany({ where: { id: { in: [riderId, driverId] } } });
    await prisma.vehicleType.delete({ where: { id: vehicleTypeId } });
    await prisma.$disconnect();
  });

  it("delivers a chat:send from the rider to the driver's trip room as chat:message", async () => {
    const riderSocket = await connectApp(signAccessToken({ id: riderId, role: "rider" }));
    const driverSocket = await connectApp(signAccessToken({ id: driverId, role: "driver" }));

    // joinTripRoom (dispatch/service.ts, on driver_accept) only moves
    // *currently connected* sockets into the trip room, so both clients
    // must already be connected before acceptance for this to work —
    // exactly the real app's connect-then-go-online-then-get-offered order.
    await handleDriverResponse(tripId, driverId, true);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const received = new Promise((resolve) => {
      driverSocket.once("chat:message", resolve);
    });

    riderSocket.emit("chat:send", { tripId, body: "hello from the rider" });

    await expect(received).resolves.toMatchObject({
      tripId,
      message: { body: "hello from the rider", senderId: riderId },
    });

    riderSocket.disconnect();
    driverSocket.disconnect();
  });

  it("persists the message sent over the socket", async () => {
    const stored = await prisma.chatMessage.findFirst({ where: { tripId, body: "hello from the rider" } });
    expect(stored).not.toBeNull();
    expect(stored?.senderId).toBe(riderId);
  });
});
