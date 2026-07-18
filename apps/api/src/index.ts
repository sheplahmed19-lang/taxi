import { createServer } from "node:http";
import { createApp } from "./app.js";
import { createRealtimeServer } from "./realtime/index.js";
import "./jobs/index.js";
import { scheduleWeeklyStatementsCron } from "./jobs/weeklyStatements.js";
import { env } from "./config/env.js";
import { logger } from "./shared/logger.js";

const app = createApp();
const httpServer = createServer(app);
createRealtimeServer(httpServer);

httpServer.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`);
});

scheduleWeeklyStatementsCron().catch((err: unknown) => {
  logger.error({ err }, "failed to schedule weekly statements cron");
});
