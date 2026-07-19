// chat module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import type { Trip } from "@prisma/client";
import { prisma } from "../../db/index.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { emitToTrip } from "../../realtime/index.js";
import { sendToUser } from "../notifications/service.js";

const SENDER_SELECT = { id: true, name: true, role: true } as const;

async function assertParticipant(tripId: string, userId: string): Promise<Trip> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    throw new NotFoundError("Trip not found");
  }
  if (trip.riderId !== userId && trip.driverId !== userId) {
    throw new ForbiddenError("Not a participant on this trip");
  }
  return trip;
}

const MESSAGE_PREVIEW_LENGTH = 120;

/**
 * Persists the message, relays it live over the trip room (chat:message —
 * anyone connected on /app sees it instantly), and separately notifies the
 * other participant via the normal notifications pipeline (DB row + socket
 * + best-effort FCM) — this is what actually reaches them if the app is
 * backgrounded, per the plan's "FCM when backgrounded" requirement.
 */
export async function sendChatMessage(tripId: string, senderId: string, body: string) {
  const trip = await assertParticipant(tripId, senderId);

  const message = await prisma.chatMessage.create({
    data: { tripId, senderId, body },
    include: { sender: { select: SENDER_SELECT } },
  });

  emitToTrip(tripId, "chat:message", { tripId, message });

  const recipientId = trip.riderId === senderId ? trip.driverId : trip.riderId;
  if (recipientId) {
    await sendToUser(recipientId, {
      title: message.sender.name ?? "New message",
      body: body.length > MESSAGE_PREVIEW_LENGTH ? `${body.slice(0, MESSAGE_PREVIEW_LENGTH - 3)}...` : body,
      data: { type: "chat_message", tripId, messageId: message.id },
    });
  }

  return message;
}

export async function listChatMessages(tripId: string, userId: string) {
  await assertParticipant(tripId, userId);
  return prisma.chatMessage.findMany({
    where: { tripId },
    orderBy: { createdAt: "asc" },
    include: { sender: { select: SENDER_SELECT } },
  });
}

/** Marks every message from the OTHER participant as read — backs an unread badge in the (deferred) chat UI. */
export async function markChatMessagesRead(tripId: string, userId: string): Promise<void> {
  await assertParticipant(tripId, userId);
  await prisma.chatMessage.updateMany({
    where: { tripId, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });
}
