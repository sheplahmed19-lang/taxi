import { z } from "zod";

export const requestPayoutSchema = z.object({
  amount: z.number().int().positive(),
});

export const rejectPayoutSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const markPayoutPaidSchema = z.object({
  method: z.string().min(1).max(60),
});

export const listPayoutsQuerySchema = z.object({
  status: z.enum(["requested", "approved", "paid", "rejected"]).optional(),
});
