import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import S3rver from "s3rver";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const PORT = 9100;
let server: S3rver | undefined;

beforeAll(async () => {
  // MinIO no longer publishes a Windows binary (the old URL returns 410) and
  // this machine has no Docker. When S3_* is unset, stand in with s3rver,
  // which speaks the same API as Supabase Storage and MinIO. A configured
  // S3_ENDPOINT (Supabase, or MinIO on the USC server) is used as-is.
  if (!process.env.S3_ENDPOINT) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "recdms-s3-"));
    server = new S3rver({
      address: "127.0.0.1",
      port: PORT,
      silent: true,
      directory,
      resetOnClose: true,
      vhostBuckets: false,
      configureBuckets: [{ name: "recdms-files" }],
    });
    await server.run();
    process.env.S3_ENDPOINT = `http://127.0.0.1:${PORT}`;
    process.env.S3_BUCKET = "recdms-files";
    process.env.S3_ACCESS_KEY = "S3RVER";
    process.env.S3_SECRET_KEY = "S3RVER";
    process.env.S3_REGION = "us-east-1";
  }

  const defaults: Record<string, string> = {
    DATABASE_URL: "postgresql://recdms:recdms@127.0.0.1:5432/recdms_test",
    DIRECT_URL: "postgresql://recdms:recdms@127.0.0.1:5432/recdms_test",
    AUTH_SECRET: "test-secret",
    AUTH_URL: "http://127.0.0.1:3000",
    SMTP_URL: "smtp://127.0.0.1:1025",
    EMAIL_FROM: "REC-DMS <noreply@localhost>",
    APP_TIMEZONE: "Asia/Manila",
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]) process.env[key] = value;
  }
});

afterAll(async () => {
  await server?.close();
});

it("round-trips an object through putObject and getSignedDownloadUrl", async () => {
  vi.resetModules();
  const { getS3Client, putObject, getSignedDownloadUrl, deleteObject } = await import(
    "@/server/storage"
  );
  const client = getS3Client();
  const bucket = process.env.S3_BUCKET ?? "recdms-files";
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
      throw error;
    }
  }

  const key = `tests/${crypto.randomUUID()}.txt`;
  const body = Buffer.from("rec-dms storage round-trip");
  try {
    await putObject(key, body, "text/plain");
    const url = await getSignedDownloadUrl(key, 60);
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    const downloaded = Buffer.from(await response.arrayBuffer());
    expect(downloaded.equals(body)).toBe(true);
  } finally {
    await deleteObject(key);
  }
});
