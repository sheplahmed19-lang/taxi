import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { sendBroadcast } from "../src/modules/admin/service.js";
import { sendBroadcastSchema } from "../src/modules/admin/schemas.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { closeBroadcasts } from "../src/jobs/broadcasts.js";
import { NotFoundError } from "../src/shared/errors.js";

async function waitFor(conditionFn: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await conditionFn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition not met in time");
}

let zoneId: string;
let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];

async function makeUser(phone: string, role: "rider" | "driver") {
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, role, wallet: role === "driver" ? { create: { balance: 0 } } : undefined },
  });
  userIds.push(user.id);
  return user.id;
}

async function makeOnlineDriverAt(phone: string, plate: string, lat: number, lng: number): Promise<string> {
  const driverId = await makeUser(phone, "driver");
  await registerDriver(driverId, { vehicleTypeId, plate });
  await approveDriver(driverId);
  await setAvailability(driverId, true);
  await recordLocation(driverId, { lat, lng });
  return driverId;
}

describe("admin broadcasts", () => {
  beforeAll(async () => {
    const zone = await prisma.zone.findFirstOrThrow({ where: { name: "Test Zone — Downtown" } });
    zoneId = zone.id;

    const vt = await prisma.vehicleType.create({
      data: {
        name: `BroadcastTest-${Date.now()}-${Math.random()}`,
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
    await closeBroadcasts();
    await prisma.auditLog.deleteMany({ where: { targetType: "broadcast" } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    for (const id of userIds) {
      await prisma.oweAmount.deleteMany({ where: { driverId: id } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("sendBroadcastSchema requires a zoneId when segment is \"zone\"", () => {
    const result = sendBroadcastSchema.safeParse({ title: "Hi", body: "there", segment: "zone" });
    expect(result.success).toBe(false);
  });

  it("all_riders reaches every rider and no drivers", async () => {
    const rider1 = await makeUser("+201000044401", "rider");
    const rider2 = await makeUser("+201000044402", "rider");
    const driver1 = await makeUser("+201000044411", "driver");

    const result = await sendBroadcast("admin-1", { title: "Surge pricing", body: "Fares are higher right now", segment: "all_riders" });
    expect(result.recipientCount).toBeGreaterThanOrEqual(2);

    await waitFor(async () => {
      const a = await prisma.notification.findFirst({ where: { userId: rider1, title: "Surge pricing" } });
      const b = await prisma.notification.findFirst({ where: { userId: rider2, title: "Surge pricing" } });
      return a !== null && b !== null;
    });

    const driverNotification = await prisma.notification.findFirst({ where: { userId: driver1, title: "Surge pricing" } });
    expect(driverNotification).toBeNull();
  });

  it("all_drivers reaches every driver and no riders", async () => {
    const rider = await makeUser("+201000044403", "rider");
    const driver = await makeUser("+201000044412", "driver");

    await sendBroadcast("admin-1", { title: "New shift bonus", body: "Extra pay this weekend", segment: "all_drivers" });

    await waitFor(async () => {
      const n = await prisma.notification.findFirst({ where: { userId: driver, title: "New shift bonus" } });
      return n !== null;
    });

    const riderNotification = await prisma.notification.findFirst({ where: { userId: rider, title: "New shift bonus" } });
    expect(riderNotification).toBeNull();
  });

  it("zone reaches only online drivers currently positioned inside the zone", async () => {
    const insideDriver = await makeOnlineDriverAt("+201000044413", "BCAST-IN", 30.05, 31.23); // inside Test Zone — Downtown
    const outsideDriver = await makeOnlineDriverAt("+201000044414", "BCAST-OUT", 29.5, 31.0); // outside every zone

    // recipientCount can't be pinned to exactly 1: other test files running
    // in the same suite may leave their own online drivers positioned
    // inside this same real zone polygon at the time this runs. What must
    // hold regardless is the inside/outside split checked below.
    const result = await sendBroadcast("admin-1", {
      title: "Zone event",
      body: "High demand downtown",
      segment: "zone",
      zoneId,
    });
    expect(result.recipientCount).toBeGreaterThanOrEqual(1);

    await waitFor(async () => {
      const n = await prisma.notification.findFirst({ where: { userId: insideDriver, title: "Zone event" } });
      return n !== null;
    });

    const outsideNotification = await prisma.notification.findFirst({ where: { userId: outsideDriver, title: "Zone event" } });
    expect(outsideNotification).toBeNull();
  });

  it("zone segment 404s on an unknown zoneId", async () => {
    await expect(
      sendBroadcast("admin-1", { title: "x", body: "y", segment: "zone", zoneId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("records an audit log entry for every broadcast sent", async () => {
    await sendBroadcast("admin-42", { title: "Audit me", body: "check the log", segment: "all_riders" });

    const entry = await prisma.auditLog.findFirst({
      where: { actorId: "admin-42", action: "broadcast.send", targetType: "broadcast" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry).not.toBeNull();
    expect((entry?.meta as { title: string })?.title).toBe("Audit me");
  });

  it("an empty segment still logs but enqueues nothing", async () => {
    const emptyZone = await prisma.zone.create({
      data: { name: `EmptyZone-${Date.now()}`, fareOverrides: {}, active: true },
    });
    await prisma.$executeRaw`
      UPDATE zones SET polygon = ST_GeomFromText(
        'POLYGON((60 60, 61 60, 61 61, 60 61, 60 60))', 4326
      ) WHERE id = ${emptyZone.id}
    `;

    const result = await sendBroadcast("admin-1", { title: "Nobody here", body: "empty", segment: "zone", zoneId: emptyZone.id });
    expect(result.recipientCount).toBe(0);

    await prisma.zone.delete({ where: { id: emptyZone.id } });
  });
});
