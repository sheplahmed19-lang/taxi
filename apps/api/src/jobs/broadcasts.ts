import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";
import { sendToUser } from "../modules/notifications/service.js";

function createConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const queueConnection = createConnection();
const workerConnection = createConnection();

interface BroadcastJobData {
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export const broadcastQueue = new Queue<BroadcastJobData>("broadcast", { connection: queueConnection });

const broadcastWorker = new Worker<BroadcastJobData>(
  "broadcast",
  async (job: Job<BroadcastJobData>) => {
    const { userIds, title, body, data } = job.data;
    for (const userId of userIds) {
      try {
        await sendToUser(userId, { title, body, data });
      } catch (err) {
        // One recipient's failure (e.g. a stale FCM token) must never
        // abort the rest of the batch.
        logger.warn({ err, userId }, "broadcast delivery to one recipient failed");
      }
    }
  },
  { connection: workerConnection },
);

broadcastWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "broadcast job failed");
});

/**
 * Off the admin request path (CLAUDE.md-adjacent concern: a segment can be
 * thousands of users, and sendToUser's FCM call per recipient shouldn't
 * block the HTTP response) — see admin/service.ts:sendBroadcast.
 */
export async function enqueueBroadcast(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  await broadcastQueue.add("send", { userIds, title, body, data });
}

export async function closeBroadcasts(): Promise<void> {
  await broadcastWorker.close();
  await broadcastQueue.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
}
