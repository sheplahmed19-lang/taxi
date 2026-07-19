import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { getMyCode, getMyStats } from "./service.js";

export const referralsRouter = Router();

referralsRouter.use(requireAuth);

referralsRouter.get(
  "/my-code",
  asyncHandler(async (req, res) => {
    const data = await getMyCode(req.user!.id);
    res.json({ success: true, data });
  }),
);

referralsRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const data = await getMyStats(req.user!.id);
    res.json({ success: true, data });
  }),
);
