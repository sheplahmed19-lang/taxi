import { z } from "zod";

const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const promoFieldsSchema = {
  code: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Promo codes may only contain letters, digits, - and _"),
  type: z.enum(["flat", "percent"]),
  value: z.number().int().positive(),
  maxDiscount: z.number().int().positive().optional(),
  usageLimit: z.number().int().positive().optional(),
  perUserLimit: z.number().int().positive().optional(),
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  minFare: z.number().int().nonnegative().optional(),
  vehicleTypeIds: z.array(z.string().uuid()).default([]),
  zoneIds: z.array(z.string().uuid()).default([]),
  active: z.boolean().default(true),
};

export const createPromoSchema = z.object(promoFieldsSchema);

export const updatePromoSchema = z.object({
  code: promoFieldsSchema.code.optional(),
  type: promoFieldsSchema.type.optional(),
  value: promoFieldsSchema.value.optional(),
  maxDiscount: promoFieldsSchema.maxDiscount,
  usageLimit: promoFieldsSchema.usageLimit,
  perUserLimit: promoFieldsSchema.perUserLimit,
  validFrom: promoFieldsSchema.validFrom,
  validUntil: promoFieldsSchema.validUntil,
  minFare: promoFieldsSchema.minFare,
  vehicleTypeIds: z.array(z.string().uuid()).optional(),
  zoneIds: z.array(z.string().uuid()).optional(),
  active: z.boolean().optional(),
});

export const validatePromoSchema = z.object({
  code: z.string().min(1).max(20),
  pickup: latLngSchema,
  drop: latLngSchema,
  vehicleTypeId: z.string().uuid(),
});

export const applyPromoSchema = z.object({
  tripId: z.string().uuid(),
  code: z.string().min(1).max(20),
});
