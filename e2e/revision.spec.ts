import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loadTestEnv } from "./test-env";

// The test database only (.env.test); refuses anything else.
loadTestEnv();

/**
 * INTAKE-04: a panel return, end to end. The fixture script takes a protocol through review with two
 * flagged points, the chair's endorsement of F-37 and its release. The proponent then opens the
 * Intake tab on "Returned for revision", sees F-37 (and never F-35 or a reviewer's name), starts
 * version 2, answers the two rows, uploads the revised manuscript, signs F-38 and resubmits. The
 * adviser is told and finds the check waiting.
 */
test.describe.configure({ mode: "serial" });

type Fixture = { protocolId: string; f35: string; f37: string; leader: string; adviser: string; adviserId: string; password: string; secretNames: string[] };
let fixture: Fixture;

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test.beforeAll(() => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const output = execSync(
    `node --conditions=react-server --experimental-transform-types --import ./scripts/register-ts.mjs e2e/scripts/panel-return.ts ${suffix}`,
    { env: process.env, encoding: "utf8", timeout: 600_000 },
  );
  const line = output.trim().split(/\r?\n/).reverse().find((item) => item.startsWith("{"));
  if (!line) throw new Error(`The fixture script printed no result:\n${output}`);
  fixture = JSON.parse(line) as Fixture;
});

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(fixture.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
}

test("panel return: the proponent fixes the rows, signs F-38 and resubmits; the adviser sees it", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, fixture.leader);
  await page.goto(`/app/protocols/${fixture.protocolId}/intake`);

  // What happened, what was released, and the two rows (read-only until version 2 starts).
  const view = page.getByTestId("returned-view");
  await expect(view.getByRole("heading", { name: "Returned for revision · version 2" })).toBeVisible({ timeout: 60_000 });
  await expect(view).toContainText("Returned by the Panel");
  await expect(view).toContainText("it goes to your adviser");
  await expect(view.getByTestId("released-F-37")).toBeVisible();
  await expect(view.locator("[data-testid^=fix-row-]")).toHaveCount(2);
  for (const name of fixture.secretNames) await expect(page.locator("body")).not.toContainText(name);

  // The server refuses F-35; F-37 opens as the copy REC released.
  expect((await page.request.get(`/api/forms/${fixture.f35}/document?format=docx`)).status()).toBe(403);
  expect((await page.request.get(`/api/forms/${fixture.f37}/document?format=docx`)).status()).toBe(200);
  await page.goto(`/app/protocols/${fixture.protocolId}/forms/${fixture.f35}`);
  await expect(page.locator("body")).toContainText(/not available to you/i, { timeout: 30_000 });
  await page.goto(`/app/protocols/${fixture.protocolId}/intake`);

  await view.getByRole("button", { name: "Start version 2" }).click();
  const boxes = page.getByTestId("returned-view").getByLabel("Actions taken (page and paragraph)");
  await expect(boxes).toHaveCount(2, { timeout: 60_000 });
  await boxes.nth(0).fill("Revised the sampling section, page 4, paragraph 2.");
  await boxes.nth(1).fill("Added the data retention period, page 7, paragraph 1.");
  // Both rows answered: the server counts nothing left under "Returned for revision".
  await expect(page.getByTestId("rail-actions").getByTestId("rail-status")).toHaveText("Done", { timeout: 30_000 });

  await page.getByTestId("returned-view").getByTestId("upload-MANUSCRIPT").setInputFiles({ name: "Manuscript.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByTestId("returned-view").getByTestId("document-MANUSCRIPT")).toContainText("Manuscript_2-", { timeout: 60_000 });

  // Agree and sign: one signature puts the researcher on F-38.
  await page.getByTestId("rail-sign").click();
  const mine = page.getByTestId("signing").getByTestId("signing-mine");
  await page.getByLabel("I agree to these declarations.").check();
  await page.getByLabel("I give these consents.").check();
  await expect(mine.getByRole("button", { name: "Sign F-38" })).toBeEnabled({ timeout: 30_000 });
  await mine.getByRole("button", { name: "Sign F-38" }).click();
  const dialog = page.getByRole("dialog");
  const passwordField = dialog.locator('input[type="password"]');
  if (await passwordField.isVisible()) await passwordField.fill(fixture.password);
  await dialog.getByRole("button", { name: "Sign F-38" }).click();
  const result = page.getByTestId("action-result");
  await expect(result).toContainText("F-38 signed.", { timeout: 30_000 });
  await result.getByRole("button", { name: "OK" }).click();

  await expect(page.getByTestId("submit-bar")).toContainText("Ready to submit", { timeout: 60_000 });
  await page.getByTestId("submit-bar").getByRole("button", { name: "Submit to adviser" }).click();
  await expect(page.getByTestId("action-result")).toBeVisible({ timeout: 30_000 });

  // The adviser is told, and the check is waiting on the protocol page.
  const prisma = new PrismaClient();
  try {
    const jobs = await prisma.job.findMany({ where: { kind: "NOTIFY", payload: { path: ["protocolId"], equals: fixture.protocolId } } });
    const notice = jobs.map((job) => job.payload as { templateKey?: string; userIds?: string[] }).find((payload) => payload.templateKey === "revision.ready_for_adviser" && payload.userIds?.includes(fixture.adviserId));
    expect(notice).toBeTruthy();
  } finally {
    await prisma.$disconnect();
  }
  await page.context().clearCookies();
  await signIn(page, fixture.adviser);
  await page.goto(`/app/protocols/${fixture.protocolId}`);
  await expect(page.locator("body")).toContainText("Adviser reviews the actions taken", { timeout: 30_000 });
  for (const name of fixture.secretNames) await expect(page.locator("body")).not.toContainText(name);
});
