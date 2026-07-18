import { z } from "zod";

export const listDriversQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

export const rejectDriverSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const adjustOweSchema = z.object({
  delta: z.number().int(),
  reason: z.string().min(1).max(500),
});
