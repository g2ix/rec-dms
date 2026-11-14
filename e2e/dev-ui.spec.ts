import AxeBuilder from "@axe-core/playwright";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loadTestEnv } from "./test-env";

// The test database only (.env.test); refuses anything else.
loadTestEnv();

const password = "Usc-ethics-review-2026-protocol";
const drawerEmail = "e2e.drawer@usc.edu.ph";

/** An approved proponent: the app shell is behind sign-in, and a proponent owes no authenticator check. */
async function ensureProponent(email: string): Promise<void> {
  const prisma = new PrismaClient();
  try {
    if (await prisma.userEmail.findUnique({ where: { email } })) return;
    const verifiedAt = new Date();
    const user = await prisma.user.create({
      data: {
        firstName: "Drawer",
        familyName: "Check",
        displayName: "Drawer Check",
        name: "Drawer Check",
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
  } finally {
    await prisma.$disconnect();
  }
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20_000 });
}

test("component gallery has no serious accessibility violations", async ({ page }) => {
  await page.goto("/dev/ui");
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("theme choice is applied without waiting for a second paint", async ({ page }) => {
  await page.goto("/dev/ui");
  const theme = page.getByRole("group", { name: "Theme" }).first();
  await theme.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveClass(/theme-fade/);
  await theme.getByRole("button", { name: "System" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-pref", "system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
});

test("the mobile drawer traps focus and returns it", async ({ page }) => {
  await ensureProponent(drawerEmail);
  await signIn(page, drawerEmail);
  await page.setViewportSize({ width: 800, height: 720 });
  await page.goto("/app");
  const open = page.getByRole("button", { name: "Open menu" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Navigation" });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        const nav = document.querySelector("[role=dialog]");
        return !!active && !!nav && (nav === active || nav.contains(active));
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test.describe("visual baselines", () => {
  test.skip(process.platform !== "win32", "Visual baselines are captured on Windows.");

  test("gallery in light and dark", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dev/ui");
    await page.evaluate(() => document.fonts.ready);
    const theme = page.getByRole("group", { name: "Theme" }).first();

    await theme.getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page).toHaveScreenshot("dev-ui-light.png", {
      fullPage: true,
      animations: "disabled",
    });

    await theme.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page).toHaveScreenshot("dev-ui-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
