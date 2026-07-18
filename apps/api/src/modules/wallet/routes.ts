import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { DEFAULT_GATEWAY, initWalletTopup } from "../payments/service.js";
import { listTransactionsQuerySchema, topupInitSchema } from "./schemas.js";
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

walletRouter.post(
  "/topup/init",
  asyncHandler(async (req, res) => {
    const { amount, currency, gateway } = topupInitSchema.parse(req.body);
    const result = await initWalletTopup(req.user!.id, amount, currency, gateway ?? DEFAULT_GATEWAY);
    res.status(201).json({ success: true, data: result });
  }),
);
