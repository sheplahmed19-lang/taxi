import { z } from "zod";

const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number");

export const otpRequestSchema = z.object({
  phone: phoneSchema,
});

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  otp: z.string().min(4).max(8),
  role: z.enum(["rider", "driver"]).default("rider"),
  referralCode: z.string().min(1).max(20).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
