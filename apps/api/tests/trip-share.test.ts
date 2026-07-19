import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { prisma } from "../src/db/index.js";
import { createRealtimeServer, emitToTrip } from "../src/realtime/index.js";
import { requestTrip } from "../src/modules/dispatch/service.js";
import { createShareLink, getTripForPublicTracking } from "../src/modules/trips/service.js";
import { ForbiddenError, NotFoundError } from "../src/shared/errors.js";

const pickup = { lat: 30.05, lng: 31.23, address: "Downtown Plaza" };
const drop = { lat: 30.06, lng: 31.24, address: "Uptown Mall" };

let vehicleTypeId: string;
let riderId: string;
let otherRiderId: string;
let tripId: string;

describe("trip share tracking", () => {
  beforeAll(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `ShareTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeId = vt.id;

    const rider = await prisma.user.upsert({
      where: { phone: "+201000033301" },
      update: {},
      create: { phone: "+201000033301", role: "rider" },
    });
    riderId = rider.id;

    const other = await prisma.user.upsert({
      where: { phone: "+201000033302" },
      update: {},
      create: { phone: "+201000033302", role: "rider" },
    });
    otherRiderId = other.id;

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripId = trip.id;
  });

  afterAll(async () => {
    await prisma.tripLocation.deleteMany({ where: { tripId } });
    await prisma.ledgerEntry.deleteMany({ where: { tripId } });
    await prisma.trip.delete({ where: { id: tripId } });
    await prisma.user.deleteMany({ where: { id: { in: [riderId, otherRiderId] } } });
    await prisma.vehicleType.delete({ where: { id: vehicleTypeId } });
    await prisma.$disconnect();
  });

  describe("service", () => {
    it("createShareLink rejects a non-participant", async () => {
      await expect(createShareLink(tripId, otherRiderId)).rejects.toThrow(ForbiddenError);
    });

    it("createShareLink 404s on an unknown trip", async () => {
      await expect(createShareLink("00000000-0000-0000-0000-000000000000", riderId)).rejects.toThrow(NotFoundError);
    });

    it("createShareLink issues a token the rider (a participant) can use to track", async () => {
      const link = await createShareLink(tripId, riderId);
      expect(link.token.length).toBeGreaterThan(10);
      expect(link.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const view = await getTripForPublicTracking(tripId, link.token);
      expect(view.pickup).toEqual({ lat: pickup.lat, lng: pickup.lng });
      expect(view.drop).toEqual({ lat: drop.lat, lng: drop.lng });
      expect(view.pickupAddress).toBe(pickup.address);
      expect(view.vehicleTypeName).toBeTruthy();
      // No OTP, payment, or phone-number fields leak into the public view.
      expect(view).not.toHaveProperty("otp");
      expect(view).not.toHaveProperty("paymentMethod");
      expect(view).not.toHaveProperty("fareTotal");
    });

    it("getTripForPublicTracking rejects an unknown token", async () => {
      await expect(getTripForPublicTracking(tripId, "not-a-real-token")).rejects.toThrow(NotFoundError);
    });

    it("getTripForPublicTracking rejects a token issued for a different trip", async () => {
      const otherTrip = await requestTrip(otherRiderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
      const linkForOtherTrip = await createShareLink(otherTrip.id, otherRiderId);

      await expect(getTripForPublicTracking(tripId, linkForOtherTrip.token)).rejects.toThrow(NotFoundError);

      await prisma.ledgerEntry.deleteMany({ where: { tripId: otherTrip.id } });
      await prisma.trip.delete({ where: { id: otherTrip.id } });
    });
  });

  describe("/public socket namespace", () => {
    let httpServer: ReturnType<typeof createServer>;
    let baseUrl: string;

    beforeAll(async () => {
      httpServer = createServer();
      createRealtimeServer(httpServer);
      await new Promise<void>((resolve) => httpServer.listen(0, resolve));
      const { port } = httpServer.address() as AddressInfo;
      baseUrl = `http://localhost:${port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    function connect(auth: Record<string, string>): Promise<ClientSocket> {
      return new Promise((resolve, reject) => {
        const socket = ioClient(`${baseUrl}/public`, { auth, reconnection: false, timeout: 2000 });
        socket.on("connect", () => resolve(socket));
        socket.on("connect_error", (err) => reject(err));
      });
    }

    it("rejects a connection with no token", async () => {
      await expect(connect({ tripId })).rejects.toThrow();
    });

    it("rejects a connection with an invalid token", async () => {
      await expect(connect({ tripId, token: "bogus" })).rejects.toThrow();
    });

    it("rejects a token that doesn't match the given tripId", async () => {
      const link = await createShareLink(tripId, riderId);
      await expect(connect({ tripId: "00000000-0000-0000-0000-000000000000", token: link.token })).rejects.toThrow();
    });

    it("accepts a valid token+tripId and relays live trip events broadcast via emitToTrip", async () => {
      const link = await createShareLink(tripId, riderId);
      const socket = await connect({ tripId, token: link.token });
      expect(socket.connected).toBe(true);

      const received = new Promise((resolve) => {
        socket.once("trip:driver_location", resolve);
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      emitToTrip(tripId, "trip:driver_location", { lat: 30.051, lng: 31.231, heading: 90 });

      await expect(received).resolves.toMatchObject({ lat: 30.051, lng: 31.231 });
      socket.disconnect();
    });

    it("does not relay another trip's events to this trip's tracker", async () => {
      const link = await createShareLink(tripId, riderId);
      const socket = await connect({ tripId, token: link.token });

      let receivedWrongEvent = false;
      socket.once("trip:status", () => {
        receivedWrongEvent = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      emitToTrip("00000000-0000-0000-0000-000000000000", "trip:status", { tripId: "other", status: "started" });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(receivedWrongEvent).toBe(false);
      socket.disconnect();
    });
  });
});
