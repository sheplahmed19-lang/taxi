import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";
import { markOffline } from "../modules/drivers/service.js";

/**
 * On socket disconnect, a driver gets a 60s grace period before being
 * marked offline (dropped from the live GEO index) — covers brief network
 * blips / app backgrounding without flapping their availability. See
 * docs/plan.md Phase 1.3.
 */
const GRACE_PERIOD_MS = 60_000;

function createConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const queueConnection = createConnection();
const workerConnection = createConnection();

interface GraceJobData {
  driverId: string;
}

export const offlineGraceQueue = new Queue<GraceJobData>("driver-offline-grace", { connection: queueConnection });

const offlineGraceWorker = new Worker<GraceJobData>(
  "driver-offline-grace",
  async (job: Job<GraceJobData>) => {
    const { driverId } = job.data;
    const stillConnected = (await queueConnection.scard(`user:${driverId}:sockets`)) > 0;
    if (stillConnected) {
      return;
    }
    await markOffline(driverId);
    logger.debug({ driverId }, "driver marked offline after disconnect grace period");
  },
  { connection: workerConnection },
);

offlineGraceWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "driver offline grace job failed");
});

/**
 * Schedules a check `delayMs` from now (default GRACE_PERIOD_MS); a
 * reconnect before then makes it a no-op. `delayMs` is overridable so tests
 * don't have to wait out a real 60s grace period.
 */
export async function scheduleOfflineGraceCheck(driverId: string, delayMs = GRACE_PERIOD_MS): Promise<void> {
  await offlineGraceQueue.add(
    "check",
    { driverId },
    { delay: delayMs, jobId: driverId },
  );
}

export async function closeDriverOfflineGrace(): Promise<void> {
  await offlineGraceWorker.close();
  await offlineGraceQueue.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
}
