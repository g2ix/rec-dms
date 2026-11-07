import { expect, test, type Page } from "@playwright/test";

const ready = Boolean(process.env.STAGING_BASE_URL && process.env.STAGING_EMAIL && process.env.STAGING_PASSWORD);
const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

test.beforeEach(() => {
  test.skip(!ready, "Set STAGING_BASE_URL, STAGING_EMAIL, and STAGING_PASSWORD.");
});

async function signIn(page: Page, email = process.env.STAGING_EMAIL ?? "", password = process.env.STAGING_PASSWORD ?? "") {
  await page.goto("/sign-in");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("health and cron", async ({ request }) => {
  const health = await request.get("/api/health");
  expect([200, 503]).toContain(health.status());
  const body = (await health.json()) as { checks: Record<string, string>; dbMs?: number };
  expect(body.checks.database).toBeTruthy();
  if (typeof body.dbMs === "number") expect(body.dbMs).toBeLessThan(500);
  const cron = await request.get("/api/cron/jobs");
  expect(cron.status()).toBe(401);
  const scan = await request.post("/api/cron/jobs", { headers: { Authorization: "Bearer wrong" } });
  expect(scan.status()).toBe(401);
});

test("sign-in reaches the protocol list", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20_000 });
  await page.goto("/app/protocols");
  await expect(page.getByRole("heading", { name: "My protocols" })).toBeVisible();
});

test("EICAR upload is blocked", async ({ page }) => {
  test.skip(!process.env.STAGING_PROTOCOL_PATH, "Set STAGING_PROTOCOL_PATH to a working protocol, for example /app/protocols/<id>/uploads.");
  await signIn(page);
  await page.goto(process.env.STAGING_PROTOCOL_PATH ?? "/");
  await page.locator("#upload-kind").selectOption("SUPPORTING");
  await page.locator("#upload-file").setInputFiles({
    name: "eicar.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(eicar),
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByText("Blocked")).toBeVisible({ timeout: 120_000 });
});

test("a form PDF downloads", async ({ page }) => {
  test.skip(!process.env.STAGING_FORM_PATH, "Set STAGING_FORM_PATH to a form page.");
  await signIn(page);
  await page.goto(process.env.STAGING_FORM_PATH ?? "/");
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "Download PDF" }).click();
  const file = await download;
  expect(file.suggestedFilename().toLowerCase()).toContain(".pdf");
});
