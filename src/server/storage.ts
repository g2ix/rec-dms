import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

let client: S3Client | undefined;

export function getS3Client(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
      // Supabase Storage and MinIO reject the default flexible checksums.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getSignedDownloadUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function deleteObject(key: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );
}
