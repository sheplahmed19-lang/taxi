import { z } from "zod";

const currentYear = new Date().getFullYear();

export const registerDriverSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  vehicleTypeId: z.string().uuid(),
  plate: z.string().min(2).max(20),
  model: z.string().max(60).optional(),
  color: z.string().max(30).optional(),
  year: z.coerce.number().int().min(1990).max(currentYear + 1).optional(),
});

export const documentTypeSchema = z.enum(["license", "national_id", "vehicle_registration", "insurance"]);

export const uploadDocumentSchema = z.object({
  type: documentTypeSchema,
});
