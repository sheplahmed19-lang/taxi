import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./shared/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

declare global {
  namespace Express {
    interface Request {
      // Captured alongside JSON parsing (see express.json below) so
      // payments/service.ts can verify the Stripe webhook signature against
      // the exact bytes Stripe signed — the parsed/re-stringified body
      // would not byte-for-byte match and would fail verification.
      rawBody?: Buffer;
    }
  }
}

import { authRouter } from "./modules/auth/index.js";
import { usersRouter } from "./modules/users/index.js";
import { driversRouter } from "./modules/drivers/index.js";
import { vehiclesRouter } from "./modules/vehicles/index.js";
import { zonesRouter } from "./modules/zones/index.js";
import { tripsRouter } from "./modules/trips/index.js";
import { dispatchRouter } from "./modules/dispatch/index.js";
import { faresRouter } from "./modules/fares/index.js";
import { walletRouter } from "./modules/wallet/index.js";
import { paymentsRouter } from "./modules/payments/index.js";
import { payoutsRouter } from "./modules/payouts/index.js";
import { promosRouter } from "./modules/promos/index.js";
import { referralsRouter } from "./modules/referrals/index.js";
import { ratingsRouter } from "./modules/ratings/index.js";
import { scheduledRouter } from "./modules/scheduled/index.js";
import { chatRouter } from "./modules/chat/index.js";
import { notificationsRouter } from "./modules/notifications/index.js";
import { reportsRouter } from "./modules/reports/index.js";
import { adminRouter } from "./modules/admin/index.js";

export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ verify: (req, _res, buf) => { (req as express.Request).rawBody = buf; } }));
  app.use(pinoHttp({ logger }));

  app.get("/health", (_req, res) => {
    res.json({ success: true, data: { status: "ok" } });
  });

  const v1 = express.Router();
  v1.use("/auth", authRouter);
  v1.use("/users", usersRouter);
  v1.use("/drivers", driversRouter);
  v1.use("/vehicles", vehiclesRouter);
  v1.use("/zones", zonesRouter);
  v1.use("/trips", tripsRouter);
  v1.use("/dispatch", dispatchRouter);
  v1.use("/fares", faresRouter);
  v1.use("/wallet", walletRouter);
  v1.use("/payments", paymentsRouter);
  v1.use("/payouts", payoutsRouter);
  v1.use("/promos", promosRouter);
  v1.use("/referrals", referralsRouter);
  v1.use("/ratings", ratingsRouter);
  v1.use("/scheduled", scheduledRouter);
  v1.use("/chat", chatRouter);
  v1.use("/notifications", notificationsRouter);
  v1.use("/reports", reportsRouter);
  v1.use("/admin", adminRouter);

  app.use("/api/v1", v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
