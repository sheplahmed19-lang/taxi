import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { listPayoutsQuerySchema, markPayoutPaidSchema, rejectPayoutSchema } from "../payouts/schemas.js";
import { approvePayout, listPayouts, markPayoutPaid, rejectPayout } from "../payouts/service.js";
import { createPromoSchema, updatePromoSchema } from "../promos/schemas.js";
import { createPromo, deletePromo, listPromos, updatePromo } from "../promos/service.js";
import { createPlanSchema, updatePlanSchema } from "../subscriptions/schemas.js";
import { createPlan, updatePlan } from "../subscriptions/service.js";
import { adjustOwe, listOweReport } from "../wallet/service.js";
import { adjustOweSchema, listDriversQuerySchema, rejectDriverSchema } from "./schemas.js";
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

adminRouter.get(
  "/payouts",
  asyncHandler(async (req, res) => {
    const { status } = listPayoutsQuerySchema.parse(req.query);
    const payouts = await listPayouts(status);
    res.json({ success: true, data: { payouts } });
  }),
);

adminRouter.post(
  "/payouts/:id/approve",
  asyncHandler(async (req, res) => {
    const payout = await approvePayout(req.params.id as string, req.user!.id);
    res.json({ success: true, data: payout });
  }),
);

adminRouter.post(
  "/payouts/:id/reject",
  asyncHandler(async (req, res) => {
    const { reason } = rejectPayoutSchema.parse(req.body);
    const payout = await rejectPayout(req.params.id as string, req.user!.id, reason);
    res.json({ success: true, data: payout });
  }),
);

adminRouter.post(
  "/payouts/:id/paid",
  asyncHandler(async (req, res) => {
    const { method } = markPayoutPaidSchema.parse(req.body);
    const payout = await markPayoutPaid(req.params.id as string, req.user!.id, method);
    res.json({ success: true, data: payout });
  }),
);

adminRouter.get(
  "/promos",
  asyncHandler(async (_req, res) => {
    const promos = await listPromos();
    res.json({ success: true, data: { promos } });
  }),
);

adminRouter.post(
  "/promos",
  asyncHandler(async (req, res) => {
    const data = createPromoSchema.parse(req.body);
    const promo = await createPromo(data);
    res.status(201).json({ success: true, data: promo });
  }),
);

adminRouter.patch(
  "/promos/:id",
  asyncHandler(async (req, res) => {
    const data = updatePromoSchema.parse(req.body);
    const promo = await updatePromo(req.params.id as string, data);
    res.json({ success: true, data: promo });
  }),
);

adminRouter.delete(
  "/promos/:id",
  asyncHandler(async (req, res) => {
    await deletePromo(req.params.id as string);
    res.json({ success: true, data: { deleted: true } });
  }),
);

adminRouter.get(
  "/owe",
  asyncHandler(async (req, res) => {
    const report = await listOweReport();
    res.json({ success: true, data: { report } });
  }),
);

adminRouter.post(
  "/owe/:driverId/adjust",
  asyncHandler(async (req, res) => {
    const { delta, reason } = adjustOweSchema.parse(req.body);
    await adjustOwe(req.params.driverId as string, delta, reason, req.user!.id);
    res.json({ success: true, data: { adjusted: true } });
  }),
);
