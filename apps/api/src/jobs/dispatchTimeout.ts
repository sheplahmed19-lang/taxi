import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";

/**
 * When a driver doesn't respond to a trip:request within dispatch_timeout_s,
 * this fires and cascades the offer to the next candidate. See
 * dispatch/service.ts and docs/plan.md Phase 1.4.
 */
function createConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const queueConnection = createConnection();
const workerConnection = createConnection();

interface DispatchTimeoutJobData {
  tripId: string;
  driverId: string;
}

export const dispatchTimeoutQueue = new Queue<DispatchTimeoutJobData>("dispatch-timeout", {
  connection: queueConnection,
});

const dispatchTimeoutWorker = new Worker<DispatchTimeoutJobData>(
  "dispatch-timeout",
  async (job: Job<DispatchTimeoutJobData>) => {
    // Dynamic import: dispatch/service.ts imports scheduleDispatchTimeout from
    // this file, so a static top-level import here would create a cycle.
    const { handleDispatchTimeout } = await import("../modules/dispatch/service.js");
    await handleDispatchTimeout(job.data.tripId, job.data.driverId);
  },
  { connection: workerConnection },
);

dispatchTimeoutWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "dispatch timeout job failed");
});

/** jobId is `${tripId}-${driverId}` so a stale job for a since-replaced offer just no-ops when it fires. */
export async function scheduleDispatchTimeout(tripId: string, driverId: string, delayMs: number): Promise<void> {
  await dispatchTimeoutQueue.add(
    "timeout",
    { tripId, driverId },
    { delay: delayMs, jobId: `${tripId}-${driverId}` },
  );
}

export async function closeDispatchTimeout(): Promise<void> {
  await dispatchTimeoutWorker.close();
  await dispatchTimeoutQueue.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
}
