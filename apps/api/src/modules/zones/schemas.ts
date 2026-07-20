import { z } from "zod";

const latLngSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export const zoneInputSchema = z.object({
  name: z.string().min(1).max(120),
  active: z.boolean().optional(),
  fareOverrides: z.record(z.string(), z.unknown()).nullable().optional(),
  polygon: z.array(latLngSchema).min(3),
});

export const updateZoneSchema = zoneInputSchema.partial();
