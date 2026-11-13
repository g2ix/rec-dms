import { hash } from "@node-rs/argon2";
import { Prisma, PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { E2E_ORIGIN, loadTestEnv } from "./test-env";

// The test database only (.env.test); refuses anything else.
loadTestEnv();

const email = "e2e.redirect@usc.edu.ph";
const password = "Usc-ethics-review-2026-protocol";

async function setDefaultView(defaultView: string | null) {
  const prisma = new PrismaClient();
  try {
    await prisma.userEmail.update({ where: { email }, data: { defaultView } });
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureUser() {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const existing = await prisma.userEmail.findUnique({ where: { email } });
    if (existing) {
      await prisma.userEmail.update({ where: { email }, data: { defaultView: null } });
      return;
    }
    const verifiedAt = new Date();
    const user = await prisma.user.create({
      data: {
        firstName: "Redirect",
        familyName: "Check",
        displayName: "Redirect Check",
        name: "Redirect Check",
        email,
        emailVerified: verifiedAt,
        status: "ACTIVE",
        passwordHash,
        emails: { create: { email, verifiedAt, isContact: true, isPrimary: true } },
      },
      include: { emails: true },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { primaryEmailId: user.emails[0]?.id },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function signIn(page: Page) {
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe.configure({ mode: "serial" });
test.beforeAll(ensureUser);
test.afterAll(() => setDefaultView(null));
test.setTimeout(30_000);

test("signed-in visit to /sign-in opens the dashboard", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20_000 });
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
});

test("signed-out visit returns to the requested page after sign-in", async ({ page }) => {
  await page.goto("/app/protocols/123");
  await expect(page).toHaveURL(/\/sign-in/);
  expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/app/protocols/123");
  await signIn(page);
  await expect(page).toHaveURL(/\/app\/protocols\/123$/, { timeout: 20_000 });
});

test("an absolute callbackUrl is ignored", async ({ page }) => {
  await page.goto("/sign-in?callbackUrl=https://example.com");
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  expect(page.url()).not.toContain("example.com");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("sign-in opens the identity default view ahead of the last used view", async ({ page }) => {
  await setDefaultView("staff");
  await page.context().addCookies([
    { name: "activeView", value: "proponent", url: E2E_ORIGIN },
  ]);
  await page.goto("/sign-in");
  await signIn(page);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByText("REC Staff", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Screening queue" })).toBeVisible();
});

test("sign-in keeps the last used view when the identity has none", async ({ page }) => {
  await setDefaultView(null);
  await page.context().addCookies([
    { name: "activeView", value: "reviewer", url: E2E_ORIGIN },
  ]);
  await page.goto("/sign-in");
  await signIn(page);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByText("Reviewer", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "My reviews" })).toBeVisible();
});

test("sign-in opens a path stored as the identity default view", async ({ page }) => {
  await setDefaultView("/app/tasks");
  await page.context().addCookies([
    { name: "activeView", value: "proponent", url: E2E_ORIGIN },
  ]);
  await page.goto("/sign-in");
  await signIn(page);
  await expect(page).toHaveURL(/\/app\/tasks$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();
});
