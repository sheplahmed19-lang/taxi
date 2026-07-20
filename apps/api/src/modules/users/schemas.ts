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

export const registerDeviceTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]).optional(),
});

// ── Admin user management (Phase 4.2) ──────────────────────────────────────

const staffRoleEnum = z.enum(["staff", "admin", "fleet_owner", "dispatcher"]);

export const adminListUsersQuerySchema = z.object({
  role: z.enum(["rider", "driver", "staff", "admin", "fleet_owner", "dispatcher"]).optional(),
  status: z.enum(["active", "suspended", "banned"]).optional(),
  search: z.string().max(120).optional(),
});

const phoneSchema = z.string().regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number");

export const createStaffUserSchema = z.object({
  phone: phoneSchema,
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(120),
  role: staffRoleEnum,
  staffRoleId: z.string().uuid().optional(),
});

export const adminUpdateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  staffRoleId: z.string().uuid().nullable().optional(),
});

export const setUserStatusSchema = z.object({
  status: z.enum(["active", "suspended", "banned"]),
});
