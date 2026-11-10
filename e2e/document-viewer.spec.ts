import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const email = "e2e.document.viewer@usc.edu.ph";
const password = "Usc-ethics-review-2026-protocol";
const title = "E2E document viewer protocol";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20_000 });
}

async function putPdf(storageKey: string, bytes: Buffer) {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const region = process.env.S3_REGION ?? "ap-southeast-1";
  if (!endpoint || !bucket || !accessKey || !secretKey) {
    throw new Error("S3_* env vars are required to seed the document viewer PDF.");
  }
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: bytes,
      ContentType: "application/pdf",
    }),
  );
}

async function ensureProtocolWithPdf(): Promise<string> {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    let userId = (await prisma.userEmail.findUnique({ where: { email } }))?.userId;
    if (!userId) {
      const verifiedAt = new Date();
      const user = await prisma.user.create({
        data: {
          firstName: "Document",
          familyName: "Viewer",
          displayName: "Document Viewer",
          name: "Document Viewer",
          email,
          emailVerified: verifiedAt,
          status: "ACTIVE",
          approvedAt: verifiedAt,
          passwordHash,
          emails: { create: { email, verifiedAt, isContact: true, isPrimary: true } },
        },
        include: { emails: true },
      });
      await prisma.user.update({ where: { id: user.id }, data: { primaryEmailId: user.emails[0]?.id } });
      userId = user.id;
    }

    let protocol = await prisma.protocol.findFirst({
      where: { title, leaderUserId: userId },
      include: { versions: true },
    });
    if (!protocol) {
      protocol = await prisma.protocol.create({
        data: {
          title,
          leaderUserId: userId,
          createdById: userId,
          institution: "University of San Carlos",
          status: "Draft",
          members: {
            create: {
              userId,
              role: "PROPONENT",
              isLeader: true,
              status: "ACTIVE",
              institution: "University of San Carlos",
              designation: "Researcher",
            },
          },
          versions: { create: { number: 1, label: "1/10Nov2026", state: "WORKING" } },
        },
        include: { versions: true },
      });
    }

    const version = protocol.versions[0];
    if (!version) throw new Error("The sample protocol has no version.");

    const existing = await prisma.storedFile.findFirst({
      where: { protocolVersionId: version.id, kind: "MANUSCRIPT", originalName: "viewer-sample.pdf" },
    });
    if (!existing) {
      const storageKey = `e2e/document-viewer/${protocol.id}/${crypto.randomUUID()}.pdf`;
      const bytes = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");
      await putPdf(storageKey, bytes);
      await prisma.storedFile.create({
        data: {
          protocolVersionId: version.id,
          kind: "MANUSCRIPT",
          originalName: "viewer-sample.pdf",
          suggestedName: "Manuscript_1_10Nov2026.pdf",
          storageKey,
          mime: "application/pdf",
          size: bytes.length,
          sha256: "e2e-document-viewer-sample",
          uploadedById: userId,
          scanStatus: "CLEAN",
        },
      });
    }

    return protocol.id;
  } finally {
    await prisma.$disconnect();
  }
}

test("opening a PDF from Uploads stays on the page after Close", async ({ page }) => {
  test.setTimeout(90_000);
  const protocolId = await ensureProtocolWithPdf();
  await signIn(page);
  await page.goto(`/app/protocols/${protocolId}/uploads`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("viewer-sample.pdf")).toBeVisible();

  await page.getByRole("button", { name: "Open" }).click();
  const viewer = page.getByTestId("document-viewer");
  await expect(viewer).toBeVisible({ timeout: 20_000 });
  await expect(viewer.getByText(/viewer-sample\.pdf|Manuscript_1_10Nov2026\.pdf/)).toBeVisible();

  await page.getByTestId("document-viewer-close").click();
  await expect(viewer).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/app/protocols/${protocolId}/uploads`));
  await expect(page.getByText("viewer-sample.pdf")).toBeVisible();
});
