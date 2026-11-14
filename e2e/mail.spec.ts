import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "./fixtures";
import { E2E_ORIGIN, MAILPIT_API, e2eCronSecret, loadTestEnv } from "./test-env";

// The test database only (.env.test); refuses anything else.
loadTestEnv();

// Real SMTP through Mailpit (nodemailer): the Auth.js sign-in link and a notice from the job runner.
const email = "e2e.mail@usc.edu.ph";
const password = "Usc-ethics-review-2026-protocol";

type MailpitSummary = { ID: string; Subject: string };

async function clearMailFor(address: string) {
  await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:${address}`)}`, { method: "DELETE" });
}

/** Waits for a message to `address` whose subject contains `subject`, and returns its text and HTML. */
async function waitForMail(address: string, subject: string): Promise<{ Text: string; HTML: string; Subject: string }> {
  let found: MailpitSummary | undefined;
  await expect
    .poll(
      async () => {
        const response = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:${address}`)}`);
        const body = (await response.json()) as { messages: MailpitSummary[] };
        found = body.messages.find((message) => message.Subject.includes(subject));
        return Boolean(found);
      },
      { timeout: 20_000, message: `no mail to ${address} with "${subject}" reached Mailpit` },
    )
    .toBe(true);
  const response = await fetch(`${MAILPIT_API}/message/${found!.ID}`);
  return (await response.json()) as { Text: string; HTML: string; Subject: string };
}

async function ensureProponent(prisma: PrismaClient): Promise<string> {
  const existing = await prisma.userEmail.findUnique({ where: { email } });
  if (existing) return existing.userId;
  const verifiedAt = new Date();
  const user = await prisma.user.create({
    data: {
      firstName: "Mail",
      familyName: "Check",
      displayName: "Mail Check",
      name: "Mail Check",
      email,
      emailVerified: verifiedAt,
      status: "ACTIVE",
      approvedAt: verifiedAt,
      passwordHash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      emails: { create: { email, verifiedAt, isContact: true, isPrimary: true } },
    },
    include: { emails: true },
  });
  await prisma.user.update({ where: { id: user.id }, data: { primaryEmailId: user.emails[0]?.id } });
  return user.id;
}

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    await ensureProponent(prisma);
  } finally {
    await prisma.$disconnect();
  }
});

test.beforeEach(async () => {
  await clearMailFor(email);
});

test("a sign-in link is emailed over SMTP and signs the person in", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Email me a sign-in link instead" }).click();
  await page.locator("#sign-in-email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();

  const mail = await waitForMail(email, "");
  const link = `${mail.Text}\n${mail.HTML}`.match(/https?:\/\/[^\s"'<>]+\/api\/auth\/callback\/nodemailer[^\s"'<>]*/)?.[0];
  expect(link, "the email holds the Auth.js callback link").toBeTruthy();
  const url = new URL(link!.replaceAll("&amp;", "&"));
  expect(url.origin).toBe(E2E_ORIGIN);

  await page.goto(url.pathname + url.search);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
});

test("a queued notice is emailed over SMTP by the job runner", async ({ request }) => {
  test.setTimeout(90_000);
  const subject = `E2E notice ${Date.now()}`;
  const prisma = new PrismaClient();
  let noticeId: string;
  try {
    const userId = await ensureProponent(prisma);
    const notice = await prisma.notification.create({
      data: {
        userId,
        type: "e2e.mail",
        title: subject,
        body: "This notice checks that queued email leaves through SMTP.",
        link: "/app",
        emailStatus: "QUEUED",
        payload: { actionHref: "/app" },
      },
    });
    noticeId = notice.id;
    await prisma.job.create({ data: { kind: "SEND_EMAIL", payload: { notificationId: notice.id }, runAt: new Date() } });
  } finally {
    await prisma.$disconnect();
  }

  const response = await request.get("/api/cron/jobs", { headers: { authorization: `Bearer ${e2eCronSecret()}` } });
  expect(response.ok()).toBe(true);

  const mail = await waitForMail(email, subject);
  expect(mail.Text).toContain("leaves through SMTP");
  expect(mail.HTML).toContain(subject);

  const check = new PrismaClient();
  try {
    const row = await check.notification.findUniqueOrThrow({ where: { id: noticeId } });
    expect(row.emailStatus).toBe("SENT");
  } finally {
    await check.$disconnect();
  }
});
