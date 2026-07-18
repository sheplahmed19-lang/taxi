import { z } from "zod";

export const ridePaymentInitSchema = z.object({
  gateway: z.enum(["stripe", "paystack"]).optional(),
});
