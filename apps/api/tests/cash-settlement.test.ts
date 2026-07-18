import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { arriveTrip, completeTrip, startTrip } from "../src/modules/trips/service.js";
import { postCashTripEarnings } from "../src/modules/wallet/service.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];

async function makeRider(phone: string): Promise<string> {
  const user = await prisma.user.upsert({ where: { phone }, update: {}, create: { phone, role: "rider" } });
  userIds.push(user.id);
  return user.id;
}

async function makeOnlineDriver(phone: string, plate: string, lat: number, lng: number): Promise<string> {
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, role: "driver", wallet: { create: { balance: 0 } } },
  });
  await registerDriver(user.id, { vehicleTypeId, plate });
  await approveDriver(user.id);
  await setAvailability(user.id, true);
  await recordLocation(user.id, { lat, lng });
  userIds.push(user.id);
  return user.id;
}

async function makeStartedTrip(riderId: string, driverId: string) {
  const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
  await handleDriverResponse(trip.id, driverId, true);
  await arriveTrip(trip.id, driverId);
  const started = await startTrip(trip.id, driverId, (await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).otp!);
  return started;
}

async function cleanupTrip(tripId: string): Promise<void> {
  await prisma.ledgerEntry.deleteMany({ where: { tripId } });
  await prisma.tripLocation.deleteMany({ where: { tripId } });
  await prisma.trip.delete({ where: { id: tripId } });
}

/** A minimal persisted trip row, for tests that exercise postCashTripEarnings directly (ledgerEntry.tripId is FK-constrained, so it must reference a real trip). */
async function makeBareTrip(riderId: string, driverId: string): Promise<string> {
  const trip = await prisma.trip.create({
    data: { riderId, driverId, vehicleTypeId, status: "completed", paymentMethod: "cash" },
  });
  return trip.id;
}

describe("cash trip close-out", () => {
  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `CashTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        nightStart: "22:00",
        nightEnd: "06:00",
        active: true,
      },
    });
    vehicleTypeId = vt.id;
    vehicleTypeIds.push(vt.id);
  });

  afterAll(async () => {
    await closeDispatchTimeout();
    for (const id of userIds) {
      await prisma.oweAmount.deleteMany({ where: { driverId: id } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("postCashTripEarnings credits the earning, debits commission, and increments owe", async () => {
    const rider = await makeRider("+201000066601");
    const driver = await makeOnlineDriver("+201000066661", "CASH-001", 30.0505, 31.2305);
    const tripId = await makeBareTrip(rider, driver);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
    const before = wallet.balance;

    await postCashTripEarnings(tripId, driver, vehicleTypeId, 1000);

    const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
    // seeded commission_pct = 20 -> commission = 200
    expect(after.balance).toBe(before + 1000 - 200);

    const owe = await prisma.oweAmount.findUniqueOrThrow({ where: { driverId: driver } });
    expect(owe.amount).toBe(200);

    const entries = await prisma.ledgerEntry.findMany({ where: { tripId } });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.type).sort()).toEqual(["commission", "ride_earning"]);

    await cleanupTrip(tripId);
  });

  it("postCashTripEarnings is idempotent per trip", async () => {
    const rider = await makeRider("+201000066602");
    const driver = await makeOnlineDriver("+201000066662", "CASH-002", 30.0505, 31.2305);
    const tripId = await makeBareTrip(rider, driver);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
    const before = wallet.balance;

    await postCashTripEarnings(tripId, driver, vehicleTypeId, 1000);
    await postCashTripEarnings(tripId, driver, vehicleTypeId, 1000); // replay

    const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
    expect(after.balance).toBe(before + 800); // not double-applied

    const owe = await prisma.oweAmount.findUniqueOrThrow({ where: { driverId: driver } });
    expect(owe.amount).toBe(200); // not doubled either

    await cleanupTrip(tripId);
  });

  it("completeTrip on a cash trip settles to paid and posts the ledger", async () => {
    const rider = await makeRider("+201000066663");
    const driver = await makeOnlineDriver("+201000066664", "CASH-003", 30.0505, 31.2305);
    const started = await makeStartedTrip(rider, driver);

    const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });

    const completed = await completeTrip(started.id, driver);
    expect(completed.status).toBe("paid");
    expect(completed.paymentStatus).toBe("paid");
    expect(completed.paidAt).not.toBeNull();

    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver } });
    const commission = Math.round((completed.fareTotal! * 20) / 100);
    expect(walletAfter.balance).toBe(walletBefore.balance + completed.fareTotal! - commission);

    const owe = await prisma.oweAmount.findUniqueOrThrow({ where: { driverId: driver } });
    expect(owe.amount).toBeGreaterThanOrEqual(commission);

    await cleanupTrip(started.id);
  });

  it("a driver who owes more than the threshold is blocked from going online again", async () => {
    const driver = await makeOnlineDriver("+201000066665", "CASH-004", 30.0505, 31.2305);
    await prisma.oweAmount.upsert({
      where: { driverId: driver },
      update: { amount: 999999 },
      create: { driverId: driver, amount: 999999 },
    });
    await setAvailability(driver, false);

    await expect(setAvailability(driver, true)).rejects.toThrow(/threshold/i);
  });
});
