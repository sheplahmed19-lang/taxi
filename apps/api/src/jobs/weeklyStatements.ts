import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";
import { prisma } from "../db/index.js";
import { uploadObject, type UploadedObject } from "../shared/storage.js";

function createConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const queueConnection = createConnection();
const workerConnection = createConnection();

export const weeklyStatementsQueue = new Queue("weekly-statements", { connection: queueConnection });

interface StatementRow {
  tripId: string;
  date: string;
  fareTotal: number;
  commission: number;
  netEarning: number;
}

/** Pure — no I/O — so it's fully unit-testable without touching S3/MinIO. */
export function buildStatementCsv(rows: StatementRow[]): string {
  const header = "trip_id,date,fare_total,commission,net_earning";
  const lines = rows.map((r) => `${r.tripId},${r.date},${r.fareTotal},${r.commission},${r.netEarning}`);
  return [header, ...lines].join("\n");
}

/**
 * Aggregates a driver's ride_earning/commission ledger entries for the
 * period into one row per trip. Both entry types share the same
 * idempotencyKey prefix (trip:<id>:...) but are matched here purely by
 * tripId + createdAt, since that's all a read needs — see
 * wallet/service.ts:postTripCommissionSplit for how they're written.
 */
async function computeStatementRows(walletId: string, periodStart: Date, periodEnd: Date): Promise<StatementRow[]> {
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      walletId,
      type: { in: ["ride_earning", "commission"] },
      tripId: { not: null },
      createdAt: { gte: periodStart, lt: periodEnd },
    },
    orderBy: { createdAt: "asc" },
  });

  const byTrip = new Map<string, { fareTotal: number; commission: number; date: string }>();
  for (const entry of entries) {
    const tripId = entry.tripId!;
    const row = byTrip.get(tripId) ?? { fareTotal: 0, commission: 0, date: entry.createdAt.toISOString().slice(0, 10) };
    if (entry.type === "ride_earning") {
      row.fareTotal += entry.credit;
    } else {
      row.commission += entry.debit;
    }
    byTrip.set(tripId, row);
  }

  return Array.from(byTrip.entries()).map(([tripId, row]) => ({
    tripId,
    date: row.date,
    fareTotal: row.fareTotal,
    commission: row.commission,
    netEarning: row.fareTotal - row.commission,
  }));
}

type UploadFn = (
  prefix: string,
  file: { buffer: Buffer; mimetype: string; originalname: string },
) => Promise<UploadedObject>;

/**
 * Generates and stores one driver's statement for [periodStart, periodEnd).
 * `upload` is injectable so tests can verify the full row -> CSV -> DB
 * record path without needing a real S3-compatible endpoint (see
 * payments/service.ts's __setGatewayForTesting for the same reasoning
 * applied to a different external boundary).
 */
export async function generateDriverStatement(
  driverId: string,
  periodStart: Date,
  periodEnd: Date,
  upload: UploadFn = uploadObject,
) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverId } });
  const rows = await computeStatementRows(wallet.id, periodStart, periodEnd);
  const csv = buildStatementCsv(rows);

  const uploaded = await upload("statements", {
    buffer: Buffer.from(csv, "utf8"),
    mimetype: "text/csv",
    originalname: `statement-${driverId}-${periodStart.toISOString().slice(0, 10)}.csv`,
  });

  return prisma.driverStatement.create({
    data: {
      driverId,
      periodStart,
      periodEnd,
      objectKey: uploaded.key,
      tripCount: rows.length,
      totalEarnings: rows.reduce((sum, r) => sum + r.fareTotal, 0),
      totalCommission: rows.reduce((sum, r) => sum + r.commission, 0),
    },
  });
}

async function generateAllDriverStatements(periodEnd: Date): Promise<void> {
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const drivers = await prisma.driverProfile.findMany({
    where: { verificationStatus: "approved" },
    select: { userId: true },
  });

  for (const driver of drivers) {
    try {
      await generateDriverStatement(driver.userId, periodStart, periodEnd);
    } catch (err) {
      logger.error({ err, driverId: driver.userId }, "failed to generate weekly statement");
    }
  }
}

const weeklyStatementsWorker = new Worker(
  "weekly-statements",
  async (job: Job) => {
    await generateAllDriverStatements(new Date(job.data.periodEnd ?? Date.now()));
  },
  { connection: workerConnection },
);

weeklyStatementsWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "weekly statements job failed");
});

/** Registers the Monday-00:00 repeatable job. Idempotent — BullMQ dedupes identical repeat configs. */
export async function scheduleWeeklyStatementsCron(): Promise<void> {
  await weeklyStatementsQueue.add(
    "generate",
    {},
    { repeat: { pattern: "0 0 * * 1" }, jobId: "weekly-statements-cron" },
  );
}

export async function closeWeeklyStatements(): Promise<void> {
  await weeklyStatementsWorker.close();
  await weeklyStatementsQueue.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
}
