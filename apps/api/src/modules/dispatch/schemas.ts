import { z } from "zod";
import { locationSchema } from "../trips/schemas.js";

export const manualBookingSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number"),
  name: z.string().min(1).max(120).optional(),
  pickup: locationSchema,
  drop: locationSchema,
  vehicleTypeId: z.string().uuid(),
  paymentMethod: z.enum(["cash", "wallet", "card"]),
  driverId: z.string().uuid().optional(),
});
