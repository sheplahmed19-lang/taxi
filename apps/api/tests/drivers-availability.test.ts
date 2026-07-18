import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { redis } from "../src/shared/redis.js";
import {
  findNearbyDrivers,
  markOffline,
  recordLocation,
  registerDriver,
  setAvailability,
} from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { ForbiddenError } from "../src/shared/errors.js";

const phone = "+201000044444";
let userId: string;
let vehicleTypeId: string;

async function cleanupRedisState() {
  const vt = await prisma.vehicleType.findFirst({ where: { name: "Economy" } });
  if (vt) {
    await redis.zrem(`drivers:online:${vt.id}`, userId);
  }
  await redis.del(`driver:${userId}:state`);
}

describe("driver availability + live location", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "driver" },
    });
    userId = user.id;

    const vehicleType = await prisma.vehicleType.findFirstOrThrow({ where: { name: "Economy" } });
    vehicleTypeId = vehicleType.id;
  });

  afterEach(async () => {
    await cleanupRedisState();
  });

  afterAll(async () => {
    await prisma.oweAmount.deleteMany({ where: { driverId: userId } });
    await prisma.vehicle.deleteMany({ where: { driverId: userId } });
    await prisma.driverProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("blocks going online before registration", async () => {
    await expect(setAvailability(userId, true)).rejects.toThrow(/register first/i);
  });

  it("blocks going online while unverified", async () => {
    await registerDriver(userId, { vehicleTypeId, plate: "AVAIL-001" });
    await expect(setAvailability(userId, true)).rejects.toThrow(ForbiddenError);
    await expect(setAvailability(userId, true)).rejects.toThrow(/not verified/i);
  });

  it("blocks going online when owe exceeds the threshold", async () => {
    await approveDriver(userId);
    await prisma.oweAmount.upsert({
      where: { driverId: userId },
      update: { amount: 999999 },
      create: { driverId: userId, amount: 999999 },
    });

    await expect(setAvailability(userId, true)).rejects.toThrow(/threshold/i);

    await prisma.oweAmount.update({ where: { driverId: userId }, data: { amount: 0 } });
  });

  it("allows going online once verified and under the owe threshold", async () => {
    const profile = await setAvailability(userId, true);
    expect(profile.online).toBe(true);
  });

  it("records a location ping into the GEO set and state hash", async () => {
    await setAvailability(userId, true);
    await recordLocation(userId, { lat: 30.05, lng: 31.23, heading: 90, speed: 20 });

    const nearby = await findNearbyDrivers({ lat: 30.05, lng: 31.23 }, vehicleTypeId, 1);
    const match = nearby.find((d) => d.driverId === userId);
    expect(match).toBeDefined();
    expect(match!.heading).toBe(90);
    expect(match!.lat).toBeCloseTo(30.05, 3);
    expect(match!.lng).toBeCloseTo(31.23, 3);
  });

  it("ignores location pings from an offline driver", async () => {
    await setAvailability(userId, false);
    await recordLocation(userId, { lat: 30.05, lng: 31.23 });

    const nearby = await findNearbyDrivers({ lat: 30.05, lng: 31.23 }, vehicleTypeId, 1);
    expect(nearby.find((d) => d.driverId === userId)).toBeUndefined();
  });

  it("going offline removes the driver from the GEO set", async () => {
    await setAvailability(userId, true);
    await recordLocation(userId, { lat: 30.05, lng: 31.23 });
    await setAvailability(userId, false);

    const nearby = await findNearbyDrivers({ lat: 30.05, lng: 31.23 }, vehicleTypeId, 1);
    expect(nearby.find((d) => d.driverId === userId)).toBeUndefined();
  });

  it("markOffline is idempotent and safe for an unregistered driver", async () => {
    await expect(markOffline("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
  });

  it("findNearbyDrivers excludes drivers outside the radius", async () => {
    await setAvailability(userId, true);
    await recordLocation(userId, { lat: 30.05, lng: 31.23 });

    // ~600km away — well outside any reasonable dispatch radius.
    const nearby = await findNearbyDrivers({ lat: 24.0, lng: 31.23 }, vehicleTypeId, 5);
    expect(nearby.find((d) => d.driverId === userId)).toBeUndefined();
  });
});
