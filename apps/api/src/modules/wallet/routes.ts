import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { listTransactionsQuerySchema } from "./schemas.js";
import { getBalance, listTransactions } from "./service.js";

export const walletRouter = Router();

walletRouter.use(requireAuth);

walletRouter.get(
  "/balance",
  asyncHandler(async (req, res) => {
    const balance = await getBalance(req.user!.id);
    res.json({ success: true, data: balance });
  }),
);

walletRouter.get(
  "/transactions",
  asyncHandler(async (req, res) => {
    const { cursor } = listTransactionsQuerySchema.parse(req.query);
    const transactions = await listTransactions(req.user!.id, cursor);
    res.json({ success: true, data: { transactions } });
  }),
);

// TODO: topup/init lands in Phase 2.2 once payments/gateway.interface.ts and a real gateway exist.
