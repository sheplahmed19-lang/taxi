import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";
import { creditReferralBonusIfPending } from "../modules/referrals/service.js";

function createConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const queueConnection = createConnection();
const workerConnection = createConnection();

interface ReferralBonusJobData {
  userId: string;
  tripId: string;
}

export const referralBonusQueue = new Queue<ReferralBonusJobData>("referral-bonus", { connection: queueConnection });

const referralBonusWorker = new Worker<ReferralBonusJobData>(
  "referral-bonus",
  async (job: Job<ReferralBonusJobData>) => {
    await creditReferralBonusIfPending(job.data.userId, job.data.tripId);
  },
  { connection: workerConnection },
);

referralBonusWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "referral bonus job failed");
});

/**
 * Enqueued once per participant (rider, and driver if assigned) the moment
 * a trip reaches "paid" — see trips/service.ts's completeTrip/markTripPaid.
 * The plan's "BullMQ job on trip completion" for referral bonus crediting;
 * kept off the request path so a slow notification/ledger post never adds
 * latency to the trip-completion response.
 */
export async function enqueueReferralBonusCheck(userId: string, tripId: string): Promise<void> {
  await referralBonusQueue.add("check", { userId, tripId });
}

export async function closeReferralBonus(): Promise<void> {
  await referralBonusWorker.close();
  await referralBonusQueue.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
}
