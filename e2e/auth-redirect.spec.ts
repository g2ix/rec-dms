import { hash } from "@node-rs/argon2";
import { Prisma, PrismaClient } from "@prisma/client";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { E2E_ORIGIN, loadTestEnv } from "./test-env";
import { confirmItIsYou, enrollAuthenticator } from "./totp";

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

/**
 * The shell shows only views the account holds, so a test of a role view grants that role first.
 * REC Staff also owe the authenticator check. `revokeRoles` puts the account back to a plain proponent.
 */
async function grantRole(key: "REC_STAFF" | "REC_MEMBER") {
  const prisma = new PrismaClient();
  try {
    const row = await prisma.userEmail.findUniqueOrThrow({ where: { email } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.create({ data: { userId: row.userId, roleId: role.id } });
    if (key === "REC_STAFF") await enrollAuthenticator(prisma, row.userId);
  } finally {
    await prisma.$disconnect();
  }
}

async function revokeRoles() {
  const prisma = new PrismaClient();
  try {
    const row = await prisma.userEmail.findUnique({ where: { email } });
    if (!row) return;
    await prisma.userRole.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await prisma.user.update({ where: { id: row.userId }, data: { totpSecret: null, totpEnabledAt: null } });
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
test.beforeAll(async () => {
  await ensureUser();
  await revokeRoles();
});
test.afterEach(revokeRoles);
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
  await grantRole("REC_STAFF");
  await page.context().addCookies([
    { name: "activeView", value: "proponent", url: E2E_ORIGIN },
  ]);
  await page.goto("/sign-in");
  await signIn(page);
  await confirmItIsYou(page);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  // The role switcher names the open view (the account button in the top bar names it too).
  await expect(page.getByRole("button", { name: "Switch role" })).toHaveText("REC Staff");
  await expect(page.getByRole("link", { name: "Screening queue" })).toBeVisible();
});

test("sign-in keeps the last used view when the identity has none", async ({ page }) => {
  await setDefaultView(null);
  await grantRole("REC_MEMBER");
  await page.context().addCookies([
    { name: "activeView", value: "reviewer", url: E2E_ORIGIN },
  ]);
  await page.goto("/sign-in");
  await signIn(page);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Switch role" })).toHaveText("Reviewer");
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
