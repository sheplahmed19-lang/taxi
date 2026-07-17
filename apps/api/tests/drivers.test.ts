import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver } from "../src/modules/drivers/service.js";
import { approveDriver, rejectDriver } from "../src/modules/admin/service.js";

const phone = "+201000066666";
let userId: string;
let vehicleTypeId: string;

describe("driver registration + admin approval", () => {
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

  afterAll(async () => {
    await prisma.vehicle.deleteMany({ where: { driverId: userId } });
    await prisma.driverProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("registers a driver with a vehicle, defaulting to pending verification", async () => {
    const profile = await registerDriver(userId, {
      vehicleTypeId,
      plate: "TEST-0001",
      model: "Corolla",
      color: "White",
      year: 2022,
    });

    expect(profile.verificationStatus).toBe("pending");
    expect(profile.vehicleId).toBeTruthy();

    const vehicle = await prisma.vehicle.findUnique({ where: { id: profile.vehicleId! } });
    expect(vehicle?.plate).toBe("TEST-0001");
  });

  it("re-registration resets a rejected driver back to pending", async () => {
    await rejectDriver(userId, "Bad photo");
    const rejected = await prisma.driverProfile.findUniqueOrThrow({ where: { userId } });
    expect(rejected.verificationStatus).toBe("rejected");
    expect(rejected.rejectionReason).toBe("Bad photo");

    const reRegistered = await registerDriver(userId, {
      vehicleTypeId,
      plate: "TEST-0002",
      model: "Elantra",
    });
    expect(reRegistered.verificationStatus).toBe("pending");
    expect(reRegistered.rejectionReason).toBeNull();
  });

  it("admin can approve a driver, clearing any rejection reason", async () => {
    await rejectDriver(userId, "Second look needed");
    const approved = await approveDriver(userId);
    expect(approved.verificationStatus).toBe("approved");
    expect(approved.rejectionReason).toBeNull();
  });

  it("rejects approving a driver with no profile", async () => {
    await expect(approveDriver("00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/i);
  });
});
