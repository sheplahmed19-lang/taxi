import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { manualBookingSchema } from "./schemas.js";
import { createManualBooking } from "./service.js";

export const dispatchRouter = Router();

dispatchRouter.use(requireAuth, requireRole("admin", "staff", "dispatcher"));

dispatchRouter.post(
  "/manual-booking",
  asyncHandler(async (req, res) => {
    const data = manualBookingSchema.parse(req.body);
    const trip = await createManualBooking(req.user!.id, data);
    res.status(201).json({ success: true, data: trip });
  }),
);
