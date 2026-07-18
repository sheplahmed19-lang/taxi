import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { createTripSchema } from "./schemas.js";
import { getTripForParticipant } from "./service.js";
import { requestTrip } from "../dispatch/service.js";

export const tripsRouter = Router();

tripsRouter.use(requireAuth);

tripsRouter.post(
  "/",
  requireRole("rider"),
  asyncHandler(async (req, res) => {
    const input = createTripSchema.parse(req.body);
    const trip = await requestTrip(req.user!.id, input);
    res.status(201).json({ success: true, data: trip });
  }),
);

tripsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const trip = await getTripForParticipant(req.params.id as string, req.user!.id);
    res.json({ success: true, data: trip });
  }),
);
