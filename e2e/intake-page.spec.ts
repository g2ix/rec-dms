import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

/**
 * INTAKE-02: a proponent prepares a whole version from the Intake tab and submits it without
 * opening another tab. Along the way: the step list's missing counts equal the submit bar's, editing
 * the title reaches the F-27 preview, a preview value links back to its section, and the page has
 * no sideways scroll at 390px.
 */

const email = "e2e.intake@usc.edu.ph";
const password = "Usc-ethics-review-2026-intake-page";
const title = `E2E intake page ${Date.now()}`;

// The smallest valid PDF: enough for the upload checks and the virus scan.
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

async function ensureUser(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    let userId = (await prisma.userEmail.findUnique({ where: { email } }))?.userId;
    if (!userId) {
      const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
      const verifiedAt = new Date();
      const user = await prisma.user.create({
        data: {
          firstName: "Intake",
          familyName: "Proponent",
          displayName: "Intake Proponent",
          name: "Intake Proponent",
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
    // A saved affiliation fills the new-protocol wizard, as for a returning proponent.
    await prisma.personProfile.upsert({
      where: { userId },
      update: {},
      create: { userId, kind: "INDUSTRY_PARTNER", institutionText: "E2E Research Partners" },
    });
    // A saved signature, as the signature page leaves it.
    if (!(await prisma.signature.findFirst({ where: { userId, active: true } }))) {
      await prisma.signature.create({ data: { userId, imageKey: `signatures/e2e/${userId}.png`, method: "UPLOADED", active: true } });
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20_000 });
}

async function railCounts(page: Page): Promise<{ rail: number; bar: number }> {
  const statuses = await page.locator(".rec-intake-rail__item [data-testid=rail-status]").allTextContents();
  const rail = statuses.reduce((sum, text) => sum + (Number.parseInt(text, 10) || 0), 0);
  const barText = (await page.getByTestId("submit-bar").textContent()) ?? "";
  const bar = /(\d+) items? left/.exec(barText)?.[1];
  return { rail, bar: bar ? Number(bar) : 0 };
}

/** Saves land, then the server's counts come back: wait for the rail and the bar to agree on a new total. */
async function expectCountsBelow(page: Page, before: number): Promise<number> {
  let now = before;
  await expect
    .poll(
      async () => {
        const counts = await railCounts(page);
        expect(counts.rail).toBe(counts.bar);
        now = counts.bar;
        return counts.bar;
      },
      { timeout: 30_000 },
    )
    .toBeLessThan(before);
  return now;
}

test.beforeAll(async () => {
  await ensureUser();
});

test("a proponent prepares and submits a version from the Intake tab", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  // A new protocol with the least the wizard needs.
  await page.goto("/app/protocols/new");
  await page.getByLabel("Protocol title").fill(title);
  await page.getByLabel("Social / Behavioral Research").check();
  await page.locator("#protocol-discipline").selectOption({ label: "Education" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(/\/app\/protocols\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const protocolUrl = page.url();

  await page.goto(`${protocolUrl}/intake`);
  const rail = page.getByRole("navigation", { name: "Intake sections" });
  await expect(rail.locator(".rec-intake-rail__item")).toHaveCount(8, { timeout: 30_000 });
  let counts = await railCounts(page);
  expect(counts.rail).toBe(counts.bar);
  expect(counts.bar).toBeGreaterThan(0);
  let left = counts.bar;

  // Study.
  await page.getByTestId("rail-study").click();
  await page.locator("#study-title").fill(`${title} edited`);
  await page.locator("#study-duration").fill("6");
  await page.locator("#study-participants").fill("30");
  await page.locator("#study-site").fill("Talamban campus");
  left = await expectCountsBelow(page, left);

  // Team: the list is here; managing it is the leader's link.
  await page.getByTestId("rail-team").click();
  await expect(page.getByTestId("team-section").getByRole("link", { name: "Manage members" })).toBeVisible();

  // Funding and budget.
  await page.getByTestId("rail-funding").click();
  await page.getByLabel("Researcher-funded").check();
  const funding = page.locator("#funding");
  await expect(funding.getByRole("button", { name: "Add a line" }).first()).toBeVisible({ timeout: 30_000 });
  await funding.getByRole("button", { name: "Add a line" }).first().click();
  await funding.getByLabel(/^Personal: /).first().fill("1500");
  left = await expectCountsBelow(page, left);

  // Participants and consent: every answer no, with the waiver reason.
  await page.getByTestId("rail-participants").click();
  const participants = page.locator("#participants");
  for (const group of await participants.getByRole("radiogroup").all()) await group.getByLabel("No").check();
  await page.locator("#waiver-reason").fill("Secondary analysis of anonymized records");
  left = await expectCountsBelow(page, left);

  // Conflict of interest.
  await page.getByTestId("rail-coi").click();
  await page.locator("#coi").getByRole("radio").first().check();
  await expectCountsBelow(page, left);

  // Where to find it: NA on every point left.
  await page.getByTestId("rail-references").click();
  for (const box of await page.locator("#references").getByRole("checkbox", { name: /not applicable/ }).all()) await box.check();

  // Documents.
  await page.getByTestId("rail-documents").click();
  await page.getByTestId("upload-MANUSCRIPT").setInputFiles({ name: "Manuscript.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByTestId("document-MANUSCRIPT")).toContainText("Manuscript.pdf", { timeout: 30_000 });
  await page.getByTestId("upload-COVER_LETTER").setInputFiles({ name: "Cover letter.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByTestId("document-COVER_LETTER")).toContainText("Cover letter.pdf", { timeout: 30_000 });

  // The title edit reaches the F-27 preview (opened from the header), and its value links back to Study.
  await page.getByRole("link", { name: "Preview forms" }).click();
  await page.getByRole("button", { name: "Preview F-27" }).click();
  const preview = page.getByTestId("form-preview");
  await expect(preview.getByRole("link", { name: `${title} edited` })).toBeVisible({ timeout: 30_000 });
  await expect(preview).not.toContainText("Recommended action");
  await preview.getByRole("link", { name: `${title} edited` }).click();
  await expect(preview).toHaveCount(0);
  await expect(page).toHaveURL(/#study$/);

  // Agree and sign: the agreements, then F-27 and F-28 one after the other.
  await page.getByTestId("rail-sign").click();
  await page.getByLabel("I agree to these declarations.").check();
  await page.getByLabel("I give these consents.").check();
  const signing = page.getByTestId("signing");
  for (let round = 0; round < 2; round += 1) {
    const signButton = signing.getByRole("button", { name: "Sign", exact: true }).first();
    await expect(signButton).toBeVisible({ timeout: 30_000 });
    const passwordField = signing.locator('input[type="password"]').first();
    if (await passwordField.isVisible()) await passwordField.fill(password);
    await signButton.click();
    await page.getByTestId("action-result").getByRole("button").first().click();
  }

  // Nothing left: the leader's submit button, with the existing confirmation.
  await expect(page.getByTestId("submit-bar")).toContainText("Ready to submit", { timeout: 60_000 });
  counts = await railCounts(page);
  expect(counts.rail).toBe(0);
  await page.getByTestId("submit-bar").getByRole("button", { name: "Submit to REC" }).click();
  await expect(page.getByTestId("action-result")).toBeVisible({ timeout: 30_000 });
});

test("the Intake page has no sideways scroll at 390px, and the submit bar does not cover the step", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/protocols");
  await page.getByRole("link", { name: /E2E intake page/ }).first().click();
  await page.waitForURL(/\/app\/protocols\/[0-9a-f-]{36}/);
  await page.goto(`${page.url().replace(/[#?].*$/, "").replace(/\/$/, "")}/intake`);
  await expect(page.locator(".rec-intake-rail__item").first()).toBeVisible({ timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bar = await page.getByTestId("submit-bar").boundingBox();
  const last = await page.locator(".rec-intake-card").boundingBox();
  expect(bar && last && last.y + last.height <= bar.y + 1).toBe(true);
});
