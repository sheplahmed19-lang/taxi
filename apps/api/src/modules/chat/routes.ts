import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { sendChatMessageSchema } from "./schemas.js";
import { listChatMessages, markChatMessagesRead, sendChatMessage } from "./service.js";

export const chatRouter = Router();

chatRouter.use(requireAuth);

chatRouter.get(
  "/:tripId/messages",
  asyncHandler(async (req, res) => {
    const messages = await listChatMessages(req.params.tripId as string, req.user!.id);
    res.json({ success: true, data: { messages } });
  }),
);

// Realtime chat:send over the socket is the primary path (see
// realtime/index.ts); this is a REST fallback for reliability and for
// clients without a live socket connection.
chatRouter.post(
  "/:tripId/messages",
  asyncHandler(async (req, res) => {
    const { body } = sendChatMessageSchema.parse(req.body);
    const message = await sendChatMessage(req.params.tripId as string, req.user!.id, body);
    res.status(201).json({ success: true, data: message });
  }),
);

chatRouter.post(
  "/:tripId/read",
  asyncHandler(async (req, res) => {
    await markChatMessagesRead(req.params.tripId as string, req.user!.id);
    res.json({ success: true, data: { read: true } });
  }),
);
