import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { listChatMessages, markChatMessagesRead, sendChatMessage } from "../src/modules/chat/service.js";
import { ForbiddenError, NotFoundError } from "../src/shared/errors.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];
const tripIds: string[] = [];

async function makeRider(phone: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, role: "rider", name: `Rider ${phone.slice(-4)}` },
  });
  userIds.push(user.id);
  return user.id;
}

async function makeOnlineDriver(phone: string, plate: string, lat: number, lng: number): Promise<string> {
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, role: "driver", name: `Driver ${phone.slice(-4)}`, wallet: { create: { balance: 0 } } },
  });
  await registerDriver(user.id, { vehicleTypeId, plate });
  await approveDriver(user.id);
  await setAvailability(user.id, true);
  await recordLocation(user.id, { lat, lng });
  userIds.push(user.id);
  return user.id;
}

async function makeAcceptedTrip(riderId: string, driverId: string) {
  const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
  await handleDriverResponse(trip.id, driverId, true);
  tripIds.push(trip.id);
  return prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
}

describe("chat", () => {
  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `ChatTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeId = vt.id;
    vehicleTypeIds.push(vt.id);
  });

  afterAll(async () => {
    await closeDispatchTimeout();
    await prisma.chatMessage.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.tripLocation.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { tripId: { in: tripIds } } });
    await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
    for (const id of userIds) {
      await prisma.oweAmount.deleteMany({ where: { driverId: id } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("rejects a non-participant sending or listing messages", async () => {
    const rider = await makeRider("+201000022201");
    const driver = await makeOnlineDriver("+201000022211", "CHAT-001", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);
    const stranger = await makeRider("+201000022202");

    await expect(sendChatMessage(trip.id, stranger, "hi")).rejects.toThrow(ForbiddenError);
    await expect(listChatMessages(trip.id, stranger)).rejects.toThrow(ForbiddenError);
  });

  it("404s on an unknown trip", async () => {
    const rider = await makeRider("+201000022203");
    await expect(sendChatMessage("00000000-0000-0000-0000-000000000000", rider, "hi")).rejects.toThrow(NotFoundError);
  });

  it("persists a message and notifies the other participant", async () => {
    const rider = await makeRider("+201000022204");
    const driver = await makeOnlineDriver("+201000022212", "CHAT-002", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);

    const message = await sendChatMessage(trip.id, rider, "On my way, 5 minutes out!");
    expect(message.senderId).toBe(rider);
    expect(message.body).toBe("On my way, 5 minutes out!");
    expect(message.sender.id).toBe(rider);

    const notification = await prisma.notification.findFirst({
      where: { userId: driver, data: { path: ["type"], equals: "chat_message" } },
    });
    expect(notification).not.toBeNull();
    expect(notification?.body).toBe("On my way, 5 minutes out!");
  });

  it("truncates a long message preview in the notification but not the stored message", async () => {
    const rider = await makeRider("+201000022205");
    const driver = await makeOnlineDriver("+201000022213", "CHAT-003", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);

    const longBody = "x".repeat(500);
    const message = await sendChatMessage(trip.id, driver, longBody);
    expect(message.body).toBe(longBody);

    const notification = await prisma.notification.findFirst({
      where: { userId: rider, data: { path: ["type"], equals: "chat_message" } },
    });
    expect(notification?.body.length).toBeLessThan(longBody.length);
    expect(notification?.body.endsWith("...")).toBe(true);
  });

  it("lists messages chronologically for either participant", async () => {
    const rider = await makeRider("+201000022206");
    const driver = await makeOnlineDriver("+201000022214", "CHAT-004", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);

    await sendChatMessage(trip.id, rider, "first");
    await sendChatMessage(trip.id, driver, "second");
    await sendChatMessage(trip.id, rider, "third");

    const asRider = await listChatMessages(trip.id, rider);
    const asDriver = await listChatMessages(trip.id, driver);
    expect(asRider.map((m) => m.body)).toEqual(["first", "second", "third"]);
    expect(asDriver.map((m) => m.body)).toEqual(["first", "second", "third"]);
  });

  it("markChatMessagesRead marks only the other participant's messages", async () => {
    const rider = await makeRider("+201000022207");
    const driver = await makeOnlineDriver("+201000022215", "CHAT-005", 30.0505, 31.2305);
    const trip = await makeAcceptedTrip(rider, driver);

    await sendChatMessage(trip.id, rider, "from rider");
    await sendChatMessage(trip.id, driver, "from driver");

    await markChatMessagesRead(trip.id, rider);

    const messages = await listChatMessages(trip.id, rider);
    const fromRider = messages.find((m) => m.senderId === rider)!;
    const fromDriver = messages.find((m) => m.senderId === driver)!;
    expect(fromRider.readAt).toBeNull(); // the rider's own message isn't "read" by them
    expect(fromDriver.readAt).not.toBeNull(); // the driver's message, read by the rider, is
  });

  it("sending before a driver is assigned succeeds with no recipient to notify", async () => {
    const rider = await makeRider("+201000022208");
    const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripIds.push(trip.id);
    expect(trip.driverId).toBeNull();

    const message = await sendChatMessage(trip.id, rider, "anyone there?");
    expect(message.body).toBe("anyone there?");

    const notifications = await prisma.notification.findMany({
      where: { data: { path: ["type"], equals: "chat_message" } },
    });
    expect(notifications.every((n) => n.userId !== rider)).toBe(true);
  });
});
