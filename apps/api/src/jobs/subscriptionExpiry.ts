import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";
import { prisma } from "../db/index.js";
import { sendToUser } from "../modules/notifications/service.js";

function createConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const queueConnection = createConnection();
const workerConnection = createConnection();

interface ExpiryJobData {
  subscriptionId: string;
}

export const subscriptionExpiryQueue = new Queue<ExpiryJobData>("subscription-expiry", { connection: queueConnection });

const subscriptionExpiryWorker = new Worker<ExpiryJobData>(
  "subscription-expiry",
  async (job: Job<ExpiryJobData>) => {
    const { subscriptionId } = job.data;
    const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    // Already superseded by a new purchase, or cancelled — the job that
    // scheduled the replacement also cancels this one, but a race between
    // "cancel the old job" and "the old job already started firing" is
    // possible, so re-check status rather than trusting the delay alone.
    if (!subscription || subscription.status !== "active") {
      return;
    }

    await prisma.$transaction([
      prisma.subscription.update({ where: { id: subscriptionId }, data: { status: "expired" } }),
      prisma.driverProfile.update({ where: { userId: subscription.driverId }, data: { earningMode: "commission" } }),
    ]);

    await sendToUser(subscription.driverId, {
      title: "Subscription expired",
      body: "Your subscription has ended — you're back on commission-based earnings until you renew.",
      data: { type: "subscription_expired", subscriptionId },
    });

    logger.debug({ subscriptionId, driverId: subscription.driverId }, "subscription expired, driver reverted to commission");
  },
  { connection: workerConnection },
);

subscriptionExpiryWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "subscription expiry job failed");
});

/** jobId = subscriptionId, so a superseding purchase can cancel the old job by id. */
export async function scheduleSubscriptionExpiry(subscriptionId: string, delayMs: number): Promise<void> {
  await subscriptionExpiryQueue.add("expire", { subscriptionId }, { delay: delayMs, jobId: subscriptionId });
}

export async function cancelSubscriptionExpiry(subscriptionId: string): Promise<void> {
  const job = await subscriptionExpiryQueue.getJob(subscriptionId);
  await job?.remove();
}

export async function closeSubscriptionExpiry(): Promise<void> {
  await subscriptionExpiryWorker.close();
  await subscriptionExpiryQueue.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
}
