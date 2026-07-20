import { z } from "zod";

export const reportsQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  format: z.enum(["json", "csv"]).optional(),
});
