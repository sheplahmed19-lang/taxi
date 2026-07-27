import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("postgresql://ride:ride@localhost:5432/ride_platform"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().default("dev-access-secret"),
  JWT_REFRESH_SECRET: z.string().default("dev-refresh-secret"),
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_ACCESS_KEY: z.string().default("rideminio"),
  S3_SECRET_KEY: z.string().default("rideminio123"),
  S3_BUCKET: z.string().default("ride-platform"),
  S3_REGION: z.string().default("us-east-1"),
  FIREBASE_PROJECT_ID: z.string().default(""),
  FIREBASE_CLIENT_EMAIL: z.string().default(""),
  FIREBASE_PRIVATE_KEY: z.string().default(""),
  GOOGLE_MAPS_API_KEY: z.string().default(""),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  PAYSTACK_SECRET_KEY: z.string().default(""),
});

export const env = envSchema.parse(process.env);

// Secrets review (Phase 5.2): JWT_ACCESS_SECRET/JWT_REFRESH_SECRET default
// to fixed dev values so a fresh clone works out of the box — but those
// literal defaults are committed in this repo's own source, so a production
// deploy that forgets to set them would silently boot with a
// publicly-known, forgeable signing secret. A minimum-length check (rather
// than only blocklisting the exact schema defaults) also catches equally
// weak stand-ins like "change-me" that a deploy might set without actually
// changing — this sandbox's own .env does exactly that.
const MIN_SECRET_LENGTH = 32;
const SECRET_KEYS = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const;

if (env.NODE_ENV === "production") {
  const tooWeak = SECRET_KEYS.filter((key) => env[key].length < MIN_SECRET_LENGTH);
  if (tooWeak.length > 0) {
    throw new Error(
      `Refusing to start in production: ${tooWeak.join(", ")} must be set to a real, high-entropy secret (>= ${MIN_SECRET_LENGTH} chars) via environment variables.`,
    );
  }
}
