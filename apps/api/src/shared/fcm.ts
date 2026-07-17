import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { prisma } from "../db/index.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

const configured = Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);

if (configured && getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Sends a push to every device registered for `userId`. No-ops (with a log)
 * when Firebase credentials aren't configured — e.g. local dev without a
 * Firebase project set up. Invalid/unregistered tokens are pruned from
 * device_tokens on send failure.
 */
export async function sendPushToUser(userId: string, notification: PushNotification): Promise<void> {
  if (!configured) {
    logger.debug({ userId }, "FCM not configured — skipping push (dev)");
    return;
  }

  const devices = await prisma.deviceToken.findMany({ where: { userId } });
  if (devices.length === 0) {
    return;
  }

  const response = await getMessaging().sendEachForMulticast({
    tokens: devices.map((d) => d.token),
    notification: { title: notification.title, body: notification.body },
    data: notification.data,
  });

  const staleTokens = response.responses
    .map((r, i) => (r.success ? null : devices[i]?.token))
    .filter((t): t is string => Boolean(t));

  if (staleTokens.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: staleTokens } } });
  }
}
