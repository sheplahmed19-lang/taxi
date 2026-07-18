import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { applyPromoToTrip } from "../trips/service.js";
import { applyPromoSchema, validatePromoSchema } from "./schemas.js";
import { previewPromo } from "./service.js";

export const promosRouter = Router();

promosRouter.use(requireAuth);

promosRouter.post(
  "/validate",
  asyncHandler(async (req, res) => {
    const { code, pickup, drop, vehicleTypeId } = validatePromoSchema.parse(req.body);
    const preview = await previewPromo(req.user!.id, code, pickup, drop, vehicleTypeId);
    res.json({ success: true, data: preview });
  }),
);

promosRouter.post(
  "/apply",
  asyncHandler(async (req, res) => {
    const { tripId, code } = applyPromoSchema.parse(req.body);
    const trip = await applyPromoToTrip(tripId, req.user!.id, code);
    res.json({ success: true, data: trip });
  }),
);
