import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
});

export const createFavoriteSchema = z.object({
  label: z.string().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(255).optional(),
});

export const updateFavoriteSchema = z.object({
  label: z.string().min(1).max(60).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  address: z.string().max(255).optional(),
});

export const listNotificationsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
});
