import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { estimateFareSchema } from "./schemas.js";
import { estimateFares } from "./service.js";

export const faresRouter = Router();

faresRouter.use(requireAuth);

faresRouter.post(
  "/estimate",
  asyncHandler(async (req, res) => {
    const { pickup, drop, vehicleTypeId } = estimateFareSchema.parse(req.body);
    const estimates = await estimateFares(pickup, drop, vehicleTypeId);
    res.json({ success: true, data: { estimates } });
  }),
);
