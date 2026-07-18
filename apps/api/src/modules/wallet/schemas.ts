import { z } from "zod";

export const listTransactionsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
});
