import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";

// BullMQ needs its own connection with maxRetriesPerRequest: null for
// blocking commands — don't share shared/redis.ts's client.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

/**
 * Demo queue proving the BullMQ wiring works end-to-end. Real queues
 * (dispatch timeouts, scheduled rides, subscription expiry, statements,
 * broadcasts, ...) land alongside the features that need them.
 */
export const demoQueue = new Queue("demo", { connection });

export const demoWorker = new Worker(
  "demo",
  async (job: Job) => {
    logger.info({ jobId: job.id, data: job.data }, "processed demo job");
  },
  { connection },
);

demoWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "demo job failed");
});

export async function closeJobs(): Promise<void> {
  await demoWorker.close();
  await demoQueue.close();
  connection.disconnect();
}
