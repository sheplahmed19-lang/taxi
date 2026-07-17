import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";

/**
 * S3-compatible object storage (MinIO in dev, per docker-compose.yml; any
 * S3-compatible provider in prod — see docs/plan.md Section 9).
 */
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

export interface UploadedObject {
  key: string;
  contentType: string;
  size: number;
}

/** Uploads a buffer under `prefix/<uuid>.<ext>` and returns the object key (not a URL). */
export async function uploadObject(
  prefix: string,
  file: { buffer: Buffer; mimetype: string; originalname: string },
): Promise<UploadedObject> {
  const ext = file.originalname.includes(".") ? file.originalname.split(".").pop() : undefined;
  const key = `${prefix}/${randomUUID()}${ext ? `.${ext}` : ""}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }),
  );

  return { key, contentType: file.mimetype, size: file.buffer.length };
}

/** Generates a time-limited signed GET URL for a private object key. */
export async function getSignedObjectUrl(key: string, expiresInSeconds = 900): Promise<string> {
  const command = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}
