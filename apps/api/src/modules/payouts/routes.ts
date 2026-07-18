import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requestPayoutSchema } from "./schemas.js";
import { listMyPayouts, requestPayout } from "./service.js";

export const payoutsRouter = Router();

payoutsRouter.use(requireAuth, requireRole("driver"));

payoutsRouter.post(
  "/request",
  asyncHandler(async (req, res) => {
    const { amount } = requestPayoutSchema.parse(req.body);
    const payout = await requestPayout(req.user!.id, amount);
    res.status(201).json({ success: true, data: payout });
  }),
);

payoutsRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const payouts = await listMyPayouts(req.user!.id);
    res.json({ success: true, data: { payouts } });
  }),
);
