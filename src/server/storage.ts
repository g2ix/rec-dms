import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
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

export async function getObjectBytes(key: string): Promise<{ body: Uint8Array; contentType?: string }> {
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );
  const body = await response.Body?.transformToByteArray();
  if (!body) throw new Error(`Object ${key} was empty.`);
  return { body, contentType: response.ContentType };
}

export async function getSignedDownloadUrl(
  key: string,
  expiresInSeconds = 300,
  /** When set, storage answers with Content-Disposition: attachment so the browser saves the file. */
  attachmentName?: string,
): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ...(attachmentName ? { ResponseContentDisposition: attachmentDisposition(attachmentName) } : {}),
    }),
    { expiresIn: expiresInSeconds },
  );
}

function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 900,
): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function storageReachable(): Promise<void> {
  await getS3Client().send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, MaxKeys: 1 }));
}

export async function deleteObject(key: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );
}
