import { z } from "zod";

export const listDriversQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

export const rejectDriverSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const adjustOweSchema = z.object({
  delta: z.number().int(),
  reason: z.string().min(1).max(500),
});

export const sendBroadcastSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(1000),
  segment: z.enum(["all_riders", "all_drivers", "zone"]),
  zoneId: z.string().uuid().optional(),
}).refine((data) => data.segment !== "zone" || Boolean(data.zoneId), {
  message: "zoneId is required when segment is \"zone\"",
  path: ["zoneId"],
});
