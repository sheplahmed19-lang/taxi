import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";
import { getConfigValue } from "../shared/config.js";
import { prisma } from "../db/index.js";
import { requestTrip } from "../modules/dispatch/service.js";
import { sendToUser } from "../modules/notifications/service.js";
import { ConflictError, NotFoundError } from "../shared/errors.js";

function createConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const queueConnection = createConnection();
const workerConnection = createConnection();

interface ScheduledRideJobData {
  scheduledRideId: string;
}

export const scheduledRidesQueue = new Queue<ScheduledRideJobData>("scheduled-rides", { connection: queueConnection });

// BullMQ custom job ids reject ":" — hyphen-joined instead.
function remindJobId(id: string): string {
  return `scheduled-ride-remind-${id}`;
}
function dispatchJobId(id: string): string {
  return `scheduled-ride-dispatch-${id}`;
}

const scheduledRidesWorker = new Worker<ScheduledRideJobData>(
  "scheduled-rides",
  async (job: Job<ScheduledRideJobData>) => {
    const { scheduledRideId } = job.data;
    const ride = await prisma.scheduledRide.findUnique({ where: { id: scheduledRideId } });
    // Already cancelled (or, in principle, already dispatched by a stale
    // duplicate job) — nothing left to do.
    if (!ride || ride.status !== "pending") {
      return;
    }

    if (job.name === "remind") {
      const minutesAway = Math.max(1, Math.round((ride.scheduledFor.getTime() - Date.now()) / 60_000));
      await sendToUser(ride.riderId, {
        title: "Upcoming scheduled ride",
        body: `Your ride is coming up in about ${minutesAway} minute${minutesAway === 1 ? "" : "s"}.`,
        data: { type: "scheduled_ride_reminder", scheduledRideId },
      });
      return;
    }

    // "dispatch": hand off to the exact same create+dispatch path an
    // immediate request goes through (dispatch/service.ts:requestTrip),
    // then link the resulting trip back to this row. A rider who happens to
    // have another active trip right at dispatch time gets a clear
    // notification instead of a silently-stuck scheduled ride.
    try {
      const trip = await requestTrip(ride.riderId, {
        pickup: { lat: ride.pickupLat, lng: ride.pickupLng, address: ride.pickupAddress },
        drop: { lat: ride.dropLat, lng: ride.dropLng, address: ride.dropAddress },
        vehicleTypeId: ride.vehicleTypeId,
        paymentMethod: ride.paymentMethod,
        scheduledAt: ride.scheduledFor,
      });
      await prisma.scheduledRide.update({
        where: { id: scheduledRideId },
        data: { tripId: trip.id, status: "dispatched" },
      });
    } catch (err) {
      await prisma.scheduledRide.update({ where: { id: scheduledRideId }, data: { status: "dispatched" } });
      const reason =
        err instanceof ConflictError || err instanceof NotFoundError ? err.message : "Something went wrong starting your ride";
      await sendToUser(ride.riderId, {
        title: "Couldn't start your scheduled ride",
        body: reason,
        data: { type: "scheduled_ride_failed", scheduledRideId },
      });
      logger.warn({ err, scheduledRideId }, "scheduled ride dispatch failed");
    }
  },
  { connection: workerConnection },
);

scheduledRidesWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "scheduled ride job failed");
});

/**
 * Schedules the T-{scheduled_reminder_minutes} reminder and the
 * T-{scheduled_dispatch_lead_minutes} reminder+dispatch job. Either delay
 * can come out non-positive if `scheduledFor` is close enough to now (e.g.
 * booked 20 minutes out with a 60-minute reminder window) — a non-positive
 * reminder is skipped outright, while the dispatch job is clamped to 0 so
 * it still fires (as soon as possible) rather than being silently dropped.
 */
export async function scheduleJobsForRide(id: string, scheduledFor: Date): Promise<void> {
  const reminderMinutes = await getConfigValue("scheduled_reminder_minutes", 60);
  const leadMinutes = await getConfigValue("scheduled_dispatch_lead_minutes", 15);

  const remindDelay = scheduledFor.getTime() - reminderMinutes * 60_000 - Date.now();
  const dispatchDelay = scheduledFor.getTime() - leadMinutes * 60_000 - Date.now();

  if (remindDelay > 0) {
    await scheduledRidesQueue.add("remind", { scheduledRideId: id }, { delay: remindDelay, jobId: remindJobId(id) });
  }
  await scheduledRidesQueue.add(
    "dispatch",
    { scheduledRideId: id },
    { delay: Math.max(dispatchDelay, 0), jobId: dispatchJobId(id) },
  );
}

export async function cancelJobsForRide(id: string): Promise<void> {
  const remindJob = await scheduledRidesQueue.getJob(remindJobId(id));
  await remindJob?.remove();
  const dispatchJob = await scheduledRidesQueue.getJob(dispatchJobId(id));
  await dispatchJob?.remove();
}

/** Used when a pending ride's pickup/drop/vehicle/time is edited — see scheduled/service.ts:updateScheduledRide. */
export async function rescheduleJobsForRide(id: string, scheduledFor: Date): Promise<void> {
  await cancelJobsForRide(id);
  await scheduleJobsForRide(id, scheduledFor);
}

export async function closeScheduledRides(): Promise<void> {
  await scheduledRidesWorker.close();
  await scheduledRidesQueue.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
}
