import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { prisma } from "../src/db/index.js";
import { createRealtimeServer, emitToUser } from "../src/realtime/index.js";
import { signAccessToken } from "../src/modules/auth/tokens.js";
import { sendToUser } from "../src/modules/notifications/service.js";

const phone = "+201000055555";
let userId: string;
let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;

function connectClient(namespace: string, token?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`${baseUrl}${namespace}`, {
      auth: token ? { token } : {},
      reconnection: false,
      timeout: 2000,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

describe("realtime", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "rider" },
    });
    userId = user.id;

    httpServer = createServer();
    createRealtimeServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("rejects a connection with no token", async () => {
    await expect(connectClient("/app")).rejects.toThrow();
  });

  it("rejects a connection with an invalid token", async () => {
    await expect(connectClient("/app", "not-a-real-token")).rejects.toThrow();
  });

  it("accepts a valid rider token on /app and joins the user room", async () => {
    const token = signAccessToken({ id: userId, role: "rider" });
    const socket = await connectClient("/app", token);
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  it("rejects a rider on /admin (role check)", async () => {
    const token = signAccessToken({ id: userId, role: "rider" });
    await expect(connectClient("/admin", token)).rejects.toThrow();
  });

  it("accepts an admin token on /admin", async () => {
    const token = signAccessToken({ id: userId, role: "admin" });
    const socket = await connectClient("/admin", token);
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  it("delivers a notification event to the user's room", async () => {
    const token = signAccessToken({ id: userId, role: "rider" });
    const socket = await connectClient("/app", token);

    const received = new Promise((resolve) => {
      socket.once("notification", resolve);
    });

    // Give the server a moment to finish the room join before emitting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    emitToUser(userId, "notification", { title: "Hi", body: "Test push", data: {} });

    await expect(received).resolves.toMatchObject({ title: "Hi", body: "Test push" });
    socket.disconnect();
  });

  it("sendToUser persists a Notification row and emits over the socket", async () => {
    const token = signAccessToken({ id: userId, role: "rider" });
    const socket = await connectClient("/app", token);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const received = new Promise((resolve) => {
      socket.once("notification", resolve);
    });

    const record = await sendToUser(userId, { title: "Ride update", body: "Your driver arrived" });
    expect(record.title).toBe("Ride update");

    await expect(received).resolves.toMatchObject({ title: "Ride update" });

    const stored = await prisma.notification.findUnique({ where: { id: record.id } });
    expect(stored).not.toBeNull();

    socket.disconnect();
  });
});
