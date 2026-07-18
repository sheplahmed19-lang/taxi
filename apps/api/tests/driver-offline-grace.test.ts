import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { redis } from "../src/shared/redis.js";
import { closeDriverOfflineGrace, scheduleOfflineGraceCheck } from "../src/jobs/driverOfflineGrace.js";
import { registerDriver, setAvailability } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";

const phone = "+201000033333";
let userId: string;

async function waitFor(conditionFn: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await conditionFn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition not met in time");
}

describe("driver offline grace period", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "driver" },
    });
    userId = user.id;

    const vehicleType = await prisma.vehicleType.findFirstOrThrow({ where: { name: "Economy" } });
    await registerDriver(userId, { vehicleTypeId: vehicleType.id, plate: "GRACE-001" });
    await approveDriver(userId);
  });

  afterAll(async () => {
    await closeDriverOfflineGrace();
    await prisma.vehicle.deleteMany({ where: { driverId: userId } });
    await prisma.driverProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("marks the driver offline once the grace period elapses with no reconnect", async () => {
    await setAvailability(userId, true);
    let profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId } });
    expect(profile.online).toBe(true);

    // No sockets registered for this user -> grace check should find them
    // disconnected and mark offline.
    await scheduleOfflineGraceCheck(userId, 100);

    await waitFor(async () => {
      profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId } });
      return profile.online === false;
    });

    expect(profile.online).toBe(false);
  });

  it("does not mark offline if the driver reconnected before the grace period elapsed", async () => {
    await setAvailability(userId, true);
    await redis.sadd(`user:${userId}:sockets`, "some-reconnected-socket-id");

    await scheduleOfflineGraceCheck(userId, 100);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { userId } });
    expect(profile.online).toBe(true);

    await redis.del(`user:${userId}:sockets`);
  });
});
