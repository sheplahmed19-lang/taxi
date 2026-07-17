import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";

// BullMQ needs maxRetriesPerRequest: null for blocking commands, and its own
// connections — don't share shared/redis.ts's client. The Worker's blocking
// commands and the Queue's regular commands must also not share a single
// connection: ioredis serializes commands over one TCP connection, so a
// blocking BRPOPLPUSH on a shared connection can starve queue.add() calls
// sent on the same connection. Each gets its own.
function createBullConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const queueConnection = createBullConnection();
const workerConnection = createBullConnection();

/**
 * Demo queue proving the BullMQ wiring works end-to-end. Real queues
 * (dispatch timeouts, scheduled rides, subscription expiry, statements,
 * broadcasts, ...) land alongside the features that need them.
 */
export const demoQueue = new Queue("demo", { connection: queueConnection });

export const demoWorker = new Worker(
  "demo",
  async (job: Job) => {
    logger.info({ jobId: job.id, data: job.data }, "processed demo job");
  },
  { connection: workerConnection },
);

demoWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "demo job failed");
});

export async function closeJobs(): Promise<void> {
  await demoWorker.close();
  await demoQueue.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
}
