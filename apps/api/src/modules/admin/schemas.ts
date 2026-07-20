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

export const setConfigValueSchema = z.object({
  value: z.unknown(),
});

export const roleInputSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  permissionIds: z.array(z.string().uuid()).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  permissionIds: z.array(z.string().uuid()).optional(),
});
