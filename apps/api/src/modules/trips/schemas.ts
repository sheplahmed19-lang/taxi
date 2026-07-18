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
  promoCode: z.string().min(1).max(20).optional(),
});

export const startTripSchema = z.object({
  otp: z.string().min(4).max(8),
});

export const cancelTripSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const rateTripSchema = z.object({
  stars: z.number().int().min(1).max(5),
  review: z.string().max(1000).optional(),
});
