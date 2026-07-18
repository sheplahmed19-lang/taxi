import { z } from "zod";

export const listTransactionsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
});

export const topupInitSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).optional(),
});
