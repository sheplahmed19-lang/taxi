import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { buildStatementCsv, closeWeeklyStatements, generateDriverStatement } from "../src/jobs/weeklyStatements.js";

const phone = "+201000077823";
const riderPhone = "+201000077824";
let driverId: string;
let riderId: string;
let walletId: string;
let vehicleTypeId: string;
const tripIds: string[] = [];

/** LedgerEntry.tripId is FK-constrained (see cash-settlement.test.ts's makeBareTrip), so each test trip needs a real Trip row, not just a string id. */
async function makeBareTrip(id: string): Promise<void> {
  await prisma.trip.create({
    data: { id, riderId, driverId, vehicleTypeId, status: "paid", paymentMethod: "cash" },
  });
}

async function makeTripLedgerEntries(
  tripId: string,
  createdAt: Date,
  fareTotal: number,
  commission: number,
): Promise<void> {
  await makeBareTrip(tripId);
  await prisma.ledgerEntry.create({
    data: {
      walletId,
      tripId,
      type: "ride_earning",
      debit: 0,
      credit: fareTotal,
      balanceAfter: 0,
      idempotencyKey: `test-stmt:${tripId}:earning`,
      createdAt,
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      walletId,
      tripId,
      type: "commission",
      debit: commission,
      credit: 0,
      balanceAfter: 0,
      idempotencyKey: `test-stmt:${tripId}:commission`,
      createdAt,
    },
  });
}

describe("weekly statements", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "driver", wallet: { create: { balance: 0 } } },
    });
    driverId = user.id;
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverId } });
    walletId = wallet.id;
    // DriverStatement.driverId FKs to DriverProfile.userId, not User.id directly.
    await prisma.driverProfile.upsert({ where: { userId: driverId }, update: {}, create: { userId: driverId } });

    const rider = await prisma.user.upsert({ where: { phone: riderPhone }, update: {}, create: { phone: riderPhone, role: "rider" } });
    riderId = rider.id;

    const vt = await prisma.vehicleType.create({
      data: {
        name: `StatementsTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeId = vt.id;
  });

  afterAll(async () => {
    await closeWeeklyStatements();
    await prisma.driverStatement.deleteMany({ where: { driverId } });
    await prisma.ledgerEntry.deleteMany({ where: { walletId } });
    await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: driverId } });
    await prisma.wallet.deleteMany({ where: { userId: driverId } });
    await prisma.user.deleteMany({ where: { id: { in: [driverId, riderId] } } });
    await prisma.vehicleType.delete({ where: { id: vehicleTypeId } });
    await prisma.$disconnect();
  });

  it("buildStatementCsv formats rows as a header + one line per trip", () => {
    const csv = buildStatementCsv([
      { tripId: "t1", date: "2026-01-01", fareTotal: 1000, commission: 200, netEarning: 800 },
      { tripId: "t2", date: "2026-01-02", fareTotal: 500, commission: 100, netEarning: 400 },
    ]);
    expect(csv).toBe(
      "trip_id,date,fare_total,commission,net_earning\n" +
        "t1,2026-01-01,1000,200,800\n" +
        "t2,2026-01-02,500,100,400",
    );
  });

  it("aggregates only trips within the period, ignoring ones before or after it, and uploads the CSV", async () => {
    const periodStart = new Date("2026-06-01T00:00:00Z");
    const periodEnd = new Date("2026-06-08T00:00:00Z");

    const inPeriodTrip1 = "stmt-trip-1";
    const inPeriodTrip2 = "stmt-trip-2";
    const beforePeriodTrip = "stmt-trip-before";
    const afterPeriodTrip = "stmt-trip-after";
    tripIds.push(inPeriodTrip1, inPeriodTrip2, beforePeriodTrip, afterPeriodTrip);

    await makeTripLedgerEntries(inPeriodTrip1, new Date("2026-06-02T10:00:00Z"), 1000, 200);
    await makeTripLedgerEntries(inPeriodTrip2, new Date("2026-06-05T10:00:00Z"), 2000, 400);
    await makeTripLedgerEntries(beforePeriodTrip, new Date("2026-05-30T10:00:00Z"), 5000, 1000);
    await makeTripLedgerEntries(afterPeriodTrip, new Date("2026-06-09T10:00:00Z"), 5000, 1000);

    let uploadedCsv: string | undefined;
    let uploadedPrefix: string | undefined;
    const fakeUpload = async (prefix: string, file: { buffer: Buffer; mimetype: string; originalname: string }) => {
      uploadedPrefix = prefix;
      uploadedCsv = file.buffer.toString("utf8");
      return { key: `${prefix}/fake-key.csv`, contentType: file.mimetype, size: file.buffer.length };
    };

    const statement = await generateDriverStatement(driverId, periodStart, periodEnd, fakeUpload);

    expect(statement.tripCount).toBe(2);
    expect(statement.totalEarnings).toBe(3000); // 1000 + 2000, not the before/after trips
    expect(statement.totalCommission).toBe(600); // 200 + 400
    expect(statement.objectKey).toBe("statements/fake-key.csv");

    expect(uploadedPrefix).toBe("statements");
    expect(uploadedCsv).toContain("trip_id,date,fare_total,commission,net_earning");
    expect(uploadedCsv).toContain(`${inPeriodTrip1},2026-06-02,1000,200,800`);
    expect(uploadedCsv).toContain(`${inPeriodTrip2},2026-06-05,2000,400,1600`);
    expect(uploadedCsv).not.toContain(beforePeriodTrip);
    expect(uploadedCsv).not.toContain(afterPeriodTrip);
  });

  it("produces an empty (header-only) statement for a driver with no trips in the period", async () => {
    const fakeUpload = async (prefix: string, file: { buffer: Buffer; mimetype: string; originalname: string }) => ({
      key: `${prefix}/empty.csv`,
      contentType: file.mimetype,
      size: file.buffer.length,
    });

    const statement = await generateDriverStatement(
      driverId,
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-01-08T00:00:00Z"),
      fakeUpload,
    );
    expect(statement.tripCount).toBe(0);
    expect(statement.totalEarnings).toBe(0);
    expect(statement.totalCommission).toBe(0);
  });
});
