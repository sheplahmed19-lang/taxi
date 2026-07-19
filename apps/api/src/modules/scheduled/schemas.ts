import { z } from "zod";

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().min(1).max(255),
});

export const createScheduledRideSchema = z.object({
  pickup: locationSchema,
  drop: locationSchema,
  vehicleTypeId: z.string().uuid(),
  paymentMethod: z.enum(["cash", "wallet", "card"]),
  scheduledFor: z.coerce.date(),
});

export const updateScheduledRideSchema = z.object({
  pickup: locationSchema.optional(),
  drop: locationSchema.optional(),
  vehicleTypeId: z.string().uuid().optional(),
  paymentMethod: z.enum(["cash", "wallet", "card"]).optional(),
  scheduledFor: z.coerce.date().optional(),
});
