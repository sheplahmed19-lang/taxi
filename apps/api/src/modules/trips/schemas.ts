import { z } from "zod";

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(255).optional(),
});

export const createTripSchema = z.object({
  pickup: locationSchema,
  drop: locationSchema,
  vehicleTypeId: z.string().uuid(),
  paymentMethod: z.enum(["cash", "wallet", "card"]),
});
