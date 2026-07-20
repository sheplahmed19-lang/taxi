import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { reportsQuerySchema } from "./schemas.js";
import {
  financialReportToCsv,
  getFinancialReport,
  getOperationsReport,
  operationsReportToCsv,
} from "./service.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth, requireRole("admin", "staff", "dispatcher"));

reportsRouter.get(
  "/financial",
  asyncHandler(async (req, res) => {
    const { from, to, format } = reportsQuerySchema.parse(req.query);
    const report = await getFinancialReport(from, to);
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="financial-report-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv"`);
      res.send(financialReportToCsv(report));
      return;
    }
    res.json({ success: true, data: report });
  }),
);

reportsRouter.get(
  "/operations",
  asyncHandler(async (req, res) => {
    const { from, to, format } = reportsQuerySchema.parse(req.query);
    const report = await getOperationsReport(from, to);
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="operations-report-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv"`);
      res.send(operationsReportToCsv(report));
      return;
    }
    res.json({ success: true, data: report });
  }),
);
