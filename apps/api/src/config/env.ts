import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("postgresql://ride:ride@localhost:5432/ride_platform"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().default("dev-access-secret"),
  JWT_REFRESH_SECRET: z.string().default("dev-refresh-secret"),
});

export const env = envSchema.parse(process.env);
