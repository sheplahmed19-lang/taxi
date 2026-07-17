import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { listDriversQuerySchema, rejectDriverSchema } from "./schemas.js";
import { approveDriver, listDrivers, rejectDriver } from "./service.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("admin", "staff"));

adminRouter.get(
  "/drivers",
  asyncHandler(async (req, res) => {
    const { status } = listDriversQuerySchema.parse(req.query);
    const drivers = await listDrivers(status);
    res.json({ success: true, data: drivers });
  }),
);

adminRouter.post(
  "/drivers/:id/approve",
  asyncHandler(async (req, res) => {
    const driver = await approveDriver(req.params.id as string);
    res.json({ success: true, data: driver });
  }),
);

adminRouter.post(
  "/drivers/:id/reject",
  asyncHandler(async (req, res) => {
    const { reason } = rejectDriverSchema.parse(req.body);
    const driver = await rejectDriver(req.params.id as string, reason);
    res.json({ success: true, data: driver });
  }),
);
