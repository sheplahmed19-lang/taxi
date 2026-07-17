import pino from "pino";
import { env } from "../config/env.js";

const options: pino.LoggerOptions = {
  level: env.NODE_ENV === "production" ? "info" : "debug",
};

if (env.NODE_ENV === "development") {
  options.transport = { target: "pino-pretty", options: { colorize: true } };
}

export const logger = pino(options);
