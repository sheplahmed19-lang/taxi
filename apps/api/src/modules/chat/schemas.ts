import { z } from "zod";

export const sendChatMessageSchema = z.object({
  body: z.string().min(1).max(2000),
});
