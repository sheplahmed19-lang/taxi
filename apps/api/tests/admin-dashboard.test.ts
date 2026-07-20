import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { getDashboardStats } from "../src/modules/admin/service.js";

const userIds: string[] = [];
const tripIds: string[] = [];
let vehicleTypeId: string;
let riderId: string;
let driverId: string;

describe("admin dashboard stats", () => {
  beforeAll(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `DashboardTest-${Date.now()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeId = vt.id;

    const rider = await prisma.user.create({ data: { phone: `+20100005${Date.now()}`.slice(0, 14), role: "rider" } });
    const driver = await prisma.user.create({
      data: { phone: `+20100006${Date.now()}`.slice(0, 14), role: "driver", wallet: { create: { balance: 0 } } },
    });
    riderId = rider.id;
    driverId = driver.id;
    userIds.push(riderId, driverId);

    await prisma.driverProfile.create({
      data: { userId: driverId, verificationStatus: "approved", online: true },
    });
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: driverId } });
    await prisma.wallet.deleteMany({ where: { userId: driverId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.delete({ where: { id: vehicleTypeId } });
    await prisma.$disconnect();
  });

  it("counts today's trips, revenue, active drivers, and completion rate", async () => {
    const before = await getDashboardStats();

    const paidTrip = await prisma.trip.create({
      data: {
        riderId,
        driverId,
        vehicleTypeId,
        status: "paid",
        paymentStatus: "paid",
        paymentMethod: "cash",
        pickupAddress: "A",
        dropAddress: "B",
        fareTotal: 2500,
        fareBreakdown: {},
        paidAt: new Date(),
      },
    });
    const requestedTrip = await prisma.trip.create({
      data: {
        riderId,
        vehicleTypeId,
        status: "requested",
        paymentStatus: "pending",
        paymentMethod: "cash",
        pickupAddress: "A",
        dropAddress: "B",
        fareTotal: 1000,
        fareBreakdown: {},
      },
    });
    tripIds.push(paidTrip.id, requestedTrip.id);

    const after = await getDashboardStats();

    expect(after.tripsToday).toBe(before.tripsToday + 2);
    expect(after.revenueToday).toBe(before.revenueToday + 2500);
    expect(after.activeDrivers).toBeGreaterThanOrEqual(1);
    expect(after.completionRate).toBeGreaterThanOrEqual(0);
    expect(after.completionRate).toBeLessThanOrEqual(100);
  });
});
