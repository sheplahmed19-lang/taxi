import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { createScheduledRideSchema, updateScheduledRideSchema } from "./schemas.js";
import {
  cancelScheduledRide,
  createScheduledRide,
  getScheduledRide,
  listMyScheduledRides,
  updateScheduledRide,
} from "./service.js";

export const scheduledRouter = Router();

scheduledRouter.use(requireAuth, requireRole("rider"));

scheduledRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createScheduledRideSchema.parse(req.body);
    const ride = await createScheduledRide(req.user!.id, data);
    res.status(201).json({ success: true, data: ride });
  }),
);

scheduledRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rides = await listMyScheduledRides(req.user!.id);
    res.json({ success: true, data: { rides } });
  }),
);

scheduledRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const ride = await getScheduledRide(req.user!.id, req.params.id as string);
    res.json({ success: true, data: ride });
  }),
);

scheduledRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = updateScheduledRideSchema.parse(req.body);
    const ride = await updateScheduledRide(req.user!.id, req.params.id as string, data);
    res.json({ success: true, data: ride });
  }),
);

scheduledRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const ride = await cancelScheduledRide(req.user!.id, req.params.id as string);
    res.json({ success: true, data: ride });
  }),
);
