import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { ValidationError } from "../../shared/errors.js";
import { handleWebhook, initRidePayment } from "./service.js";

export const paymentsRouter = Router();

// Stripe calls this directly — no bearer token, and the raw request bytes
// (captured as req.rawBody by app.ts's express.json({verify}) hook) are
// required to verify the signature, so this route is mounted before
// requireAuth below and never touches req.user.
paymentsRouter.post(
  "/webhook/:gateway",
  asyncHandler(async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string" || !req.rawBody) {
      throw new ValidationError("Missing webhook signature or body");
    }
    await handleWebhook(req.params.gateway as string, req.rawBody, signature);
    res.json({ success: true, data: { received: true } });
  }),
);

paymentsRouter.use(requireAuth);

paymentsRouter.post(
  "/ride/:tripId/init",
  asyncHandler(async (req, res) => {
    const result = await initRidePayment(req.params.tripId as string, req.user!.id);
    res.status(201).json({ success: true, data: result });
  }),
);
