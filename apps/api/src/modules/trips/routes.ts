import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { cancelTripSchema, createTripSchema, rateTripSchema, startTripSchema } from "./schemas.js";
import {
  arriveTrip,
  cancelTrip,
  completeTrip,
  getTripForParticipant,
  rateTrip,
  startTrip,
} from "./service.js";
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

tripsRouter.post(
  "/:id/arrive",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    const trip = await arriveTrip(req.params.id as string, req.user!.id);
    res.json({ success: true, data: trip });
  }),
);

tripsRouter.post(
  "/:id/start",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    const { otp } = startTripSchema.parse(req.body);
    const trip = await startTrip(req.params.id as string, req.user!.id, otp);
    res.json({ success: true, data: trip });
  }),
);

tripsRouter.post(
  "/:id/complete",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    const trip = await completeTrip(req.params.id as string, req.user!.id);
    res.json({ success: true, data: trip });
  }),
);

tripsRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const { reason } = cancelTripSchema.parse(req.body);
    const trip = await cancelTrip(req.params.id as string, req.user!.id, reason);
    res.json({ success: true, data: trip });
  }),
);

tripsRouter.post(
  "/:id/rate",
  asyncHandler(async (req, res) => {
    const { stars, review } = rateTripSchema.parse(req.body);
    const rating = await rateTrip(req.params.id as string, req.user!.id, stars, review);
    res.status(201).json({ success: true, data: rating });
  }),
);
