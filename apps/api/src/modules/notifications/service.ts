// notifications module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { emitToUser } from "../../realtime/index.js";
import { sendPushToUser } from "../../shared/fcm.js";
import { logger } from "../../shared/logger.js";

const PAGE_SIZE = 20;

export async function listForUser(userId: string, cursor?: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}

export interface NotificationInput {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * The one path for delivering a notification: DB insert (so it shows up in
 * GET /users/me/notifications) + realtime socket emit to the user's room +
 * best-effort FCM push. A push failure never fails the caller — the DB
 * record and socket emit are the source of truth.
 */
export async function sendToUser(userId: string, notification: NotificationInput) {
  const record = await prisma.notification.create({
    data: { userId, title: notification.title, body: notification.body, data: notification.data },
  });

  emitToUser(userId, "notification", {
    title: notification.title,
    body: notification.body,
    data: notification.data,
  });

  try {
    await sendPushToUser(userId, notification);
  } catch (err) {
    logger.warn({ err, userId }, "FCM push failed");
  }

  return record;
}
