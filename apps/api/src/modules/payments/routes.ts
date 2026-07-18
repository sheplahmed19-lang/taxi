import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { ValidationError } from "../../shared/errors.js";
import { ridePaymentInitSchema } from "./schemas.js";
import { DEFAULT_GATEWAY, handleWebhook, initRidePayment } from "./service.js";

export const paymentsRouter = Router();

const SIGNATURE_HEADER_BY_GATEWAY: Record<string, string> = {
  stripe: "stripe-signature",
  paystack: "x-paystack-signature",
};

// Gateways call this directly — no bearer token, and the raw request bytes
// (captured as req.rawBody by app.ts's express.json({verify}) hook) are
// required to verify the signature, so this route is mounted before
// requireAuth below and never touches req.user.
paymentsRouter.post(
  "/webhook/:gateway",
  asyncHandler(async (req, res) => {
    const gatewayName = req.params.gateway as string;
    const headerName = SIGNATURE_HEADER_BY_GATEWAY[gatewayName] ?? "x-signature";
    const signature = req.headers[headerName];
    if (typeof signature !== "string" || !req.rawBody) {
      throw new ValidationError("Missing webhook signature or body");
    }
    await handleWebhook(gatewayName, req.rawBody, signature);
    res.json({ success: true, data: { received: true } });
  }),
);

paymentsRouter.use(requireAuth);

paymentsRouter.post(
  "/ride/:tripId/init",
  asyncHandler(async (req, res) => {
    const { gateway } = ridePaymentInitSchema.parse(req.body ?? {});
    const result = await initRidePayment(req.params.tripId as string, req.user!.id, gateway ?? DEFAULT_GATEWAY);
    res.status(201).json({ success: true, data: result });
  }),
);
