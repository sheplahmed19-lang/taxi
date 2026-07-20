import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { listActiveVehicleTypes } from "./service.js";

export const vehiclesRouter = Router();

vehiclesRouter.use(requireAuth);

vehiclesRouter.get(
  "/types",
  asyncHandler(async (req, res) => {
    const types = await listActiveVehicleTypes();
    res.json({ success: true, data: { types } });
  }),
);
