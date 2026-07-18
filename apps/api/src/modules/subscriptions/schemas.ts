import { z } from "zod";

export const createPlanSchema = z.object({
  name: z.string().min(1).max(80),
  price: z.number().int().positive(),
  periodDays: z.number().int().positive(),
});

export const updatePlanSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  price: z.number().int().positive().optional(),
  periodDays: z.number().int().positive().optional(),
  active: z.boolean().optional(),
});

export const purchaseSchema = z.object({
  planId: z.string().uuid(),
  gateway: z.enum(["stripe", "paystack"]).optional(),
});
