import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { arriveTrip, completeTrip, startTrip } from "../src/modules/trips/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import {
  financialReportToCsv,
  getFinancialReport,
  getOperationsReport,
  operationsReportToCsv,
} from "../src/modules/reports/service.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];
const tripIds: string[] = [];
const suffix = Date.now();

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

/** Cash trip: completeTrip auto-settles straight through to "paid" (Phase 1.8). */
async function completeCashTrip(riderId: string, driverId: string) {
  const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
  await handleDriverResponse(trip.id, driverId, true);
  await arriveTrip(trip.id, driverId);
  const started = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
  await startTrip(trip.id, driverId, started.otp!);
  return completeTrip(trip.id, driverId);
}

describe("financial & operations reports", () => {
  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `ReportsTest-${Date.now()}-${Math.random()}`,
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
    for (const id of tripIds) {
      await prisma.tripLocation.deleteMany({ where: { tripId: id } });
      await prisma.ledgerEntry.deleteMany({ where: { tripId: id } });
      await prisma.trip.deleteMany({ where: { id } });
    }
    for (const id of userIds) {
      await prisma.oweAmount.deleteMany({ where: { driverId: id } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("getFinancialReport aggregates gross fare, commission, and driver earnings for paid trips in range", async () => {
    const rider = await makeRider(`+2010007${suffix}`.slice(0, 15));
    const driver = await makeOnlineDriver(`+2010008${suffix}`.slice(0, 15), "REPORT-001", 30.0505, 31.2305);
    const completed = await completeCashTrip(rider, driver);
    tripIds.push(completed.id);
    expect(completed.status).toBe("paid");

    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);
    const report = await getFinancialReport(from, to);

    expect(report.totals.tripsCompleted).toBeGreaterThanOrEqual(1);
    expect(report.totals.grossFare).toBeGreaterThanOrEqual(completed.fareTotal ?? 0);
    expect(report.totals.commission).toBeGreaterThan(0);
    expect(report.totals.driverEarnings).toBeGreaterThan(0);
    // commission + driverEarnings should equal the gross fare the platform collected
    expect(report.totals.commission + report.totals.driverEarnings).toBe(report.totals.grossFare);

    const outOfRange = await getFinancialReport(new Date("2000-01-01"), new Date("2000-01-02"));
    expect(outOfRange.totals.tripsCompleted).toBe(0);
  });

  it("financialReportToCsv produces a header row and one data row per date", () => {
    const csv = financialReportToCsv({
      rows: [{ date: "2026-01-01", tripsCompleted: 2, grossFare: 1000, commission: 200, driverEarnings: 800 }],
      totals: { tripsCompleted: 2, grossFare: 1000, commission: 200, driverEarnings: 800 },
    });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("date,tripsCompleted,grossFare,commission,driverEarnings");
    expect(lines[1]).toBe("2026-01-01,2,1000,200,800");
  });

  it("getOperationsReport breaks trips down by status with a completion rate and averages", async () => {
    const rider = await makeRider(`+2010009${suffix}`.slice(0, 15));
    const driver = await makeOnlineDriver(`+2010010${suffix}`.slice(0, 15), "REPORT-002", 30.0505, 31.2305);
    const completed = await completeCashTrip(rider, driver);
    tripIds.push(completed.id);

    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);
    const report = await getOperationsReport(from, to);

    expect(report.totalTrips).toBeGreaterThanOrEqual(1);
    expect(report.tripsByStatus.paid).toBeGreaterThanOrEqual(1);
    expect(report.completedTrips).toBeGreaterThanOrEqual(1);
    expect(report.completionRate).toBeGreaterThan(0);
    expect(report.completionRate).toBeLessThanOrEqual(100);
    expect(report.avgFare).toBeGreaterThan(0);
    expect(report.avgDistanceM).toBeGreaterThan(0);
  });

  it("operationsReportToCsv produces one row per status", () => {
    const csv = operationsReportToCsv({
      tripsByStatus: { paid: 3, cancelled_by_rider: 1 },
      totalTrips: 4,
      completedTrips: 3,
      cancelledTrips: 1,
      completionRate: 75,
      avgFare: 1000,
      avgDistanceM: 2000,
    });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("status,count");
    expect(lines).toContain("paid,3");
    expect(lines).toContain("cancelled_by_rider,1");
  });
});
