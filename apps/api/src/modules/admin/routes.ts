import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { createPlanSchema, updatePlanSchema } from "../subscriptions/schemas.js";
import { createPlan, updatePlan } from "../subscriptions/service.js";
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

adminRouter.post(
  "/subscriptions/plans",
  asyncHandler(async (req, res) => {
    const data = createPlanSchema.parse(req.body);
    const plan = await createPlan(data);
    res.status(201).json({ success: true, data: plan });
  }),
);

adminRouter.patch(
  "/subscriptions/plans/:id",
  asyncHandler(async (req, res) => {
    const data = updatePlanSchema.parse(req.body);
    const plan = await updatePlan(req.params.id as string, data);
    res.json({ success: true, data: plan });
  }),
);
