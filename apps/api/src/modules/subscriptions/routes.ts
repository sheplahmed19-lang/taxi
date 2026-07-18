import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { initSubscriptionPayment } from "../payments/service.js";
import { purchaseSchema } from "./schemas.js";
import { getMySubscription, listActivePlans, purchaseWithWallet } from "./service.js";

export const subscriptionsRouter = Router();

subscriptionsRouter.use(requireAuth);

subscriptionsRouter.get(
  "/plans",
  asyncHandler(async (req, res) => {
    const plans = await listActivePlans();
    res.json({ success: true, data: { plans } });
  }),
);

subscriptionsRouter.use(requireRole("driver"));

subscriptionsRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const subscription = await getMySubscription(req.user!.id);
    res.json({ success: true, data: subscription });
  }),
);

subscriptionsRouter.post(
  "/purchase",
  asyncHandler(async (req, res) => {
    const { planId, gateway } = purchaseSchema.parse(req.body);
    if (gateway) {
      const result = await initSubscriptionPayment(req.user!.id, planId, gateway);
      res.status(201).json({ success: true, data: result });
      return;
    }
    await purchaseWithWallet(req.user!.id, planId);
    res.status(201).json({ success: true, data: { activated: true } });
  }),
);
