import { z } from "zod";

const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const estimateFareSchema = z.object({
  pickup: latLngSchema,
  drop: latLngSchema,
  vehicleTypeId: z.string().uuid().optional(),
});
