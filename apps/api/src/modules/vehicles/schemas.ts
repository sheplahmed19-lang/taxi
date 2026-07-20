import { z } from "zod";

export const createVehicleTypeSchema = z.object({
  name: z.string().min(1).max(60),
  icon: z.string().max(60).optional(),
  seats: z.number().int().positive().max(20).default(4),
  baseFare: z.number().int().nonnegative(),
  perKm: z.number().int().nonnegative(),
  perMin: z.number().int().nonnegative(),
  minFare: z.number().int().nonnegative(),
  nightMultiplier: z.number().positive().optional(),
  nightStart: z.string().max(5).optional(),
  nightEnd: z.string().max(5).optional(),
  commissionPct: z.number().int().min(0).max(100).optional(),
  active: z.boolean().optional(),
});

export const updateVehicleTypeSchema = createVehicleTypeSchema.partial();

export const listVehiclesQuerySchema = z.object({
  driverId: z.string().uuid().optional(),
});

export const updateVehicleSchema = z.object({
  plate: z.string().min(2).max(20).optional(),
  model: z.string().max(60).optional(),
  color: z.string().max(30).optional(),
  year: z.coerce.number().int().optional(),
  vehicleTypeId: z.string().uuid().optional(),
});
