import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loadTestEnv } from "./test-env";
import { authenticator } from "otplib";
import { TOTP_SECRET as secret, sealTotpSecret as seal } from "./totp";

// The test database only (.env.test); refuses anything else.
loadTestEnv();

const password = "Usc-ethics-review-2026-protocol";
const email = "e2e.totp.modal@usc.edu.ph";

function wrongCode(): string {
  const right = authenticator.generate(secret);
  return right === "000000" ? "111111" : "000000";
}

let userId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.userEmail.findUnique({ where: { email } });
    const verifiedAt = new Date();
    if (existing) {
      userId = existing.userId;
    } else {
      const user = await prisma.user.create({
        data: {
          firstName: "Totp",
          familyName: "Modal",
          displayName: "Totp Modal",
          name: "Totp Modal",
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
      userId = user.id;
    }
    await prisma.user.update({ where: { id: userId }, data: { totpSecret: seal(secret), totpEnabledAt: verifiedAt } });
  } finally {
    await prisma.$disconnect();
  }
});

test.beforeEach(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.rateLimit.deleteMany({ where: { key: { in: [`totp-challenge:${userId}`, `totp:${userId}`] } } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toBeVisible({ timeout: 20_000 });
}

const box = (page: Page, n: number) => page.getByRole("textbox", { name: `Digit ${n} of 6` });

test("opens over a blurred, inert shell and loads no data behind it", async ({ page }) => {
  const notifications: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/notifications")) notifications.push(request.url());
  });
  await signIn(page);
  await page.goto("/app/protocols");
  await expect(page).toHaveURL(/\/app\/account\/security\?next=%2Fapp%2Fprotocols/);
  const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAccessibleDescription(/Enter the 6-digit code from your authenticator app\. .+ need this each time they sign in\./);
  await expect(box(page, 1)).toBeFocused();
  await expect(box(page, 1)).toHaveAttribute("autocomplete", "one-time-code");
  const behind = page.locator(".rec-totp__behind");
  await expect(behind).toHaveAttribute("inert", "");
  await expect(behind).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".rec-totp__shell")).toHaveCSS("filter", "blur(6px)");
  // Escape and a click outside the card do nothing.
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  expect(notifications).toEqual([]);
});

test("route handlers refuse real data while the check is pending", async ({ page }) => {
  await signIn(page);
  const pending = await page.request.get("/api/notifications");
  expect(pending.status()).toBe(403);
  expect(await pending.json()).toMatchObject({ code: "TOTP_REQUIRED" });
  const session = await page.request.get("/api/auth/session");
  expect(session.status()).toBe(200);
});

test("moves between boxes and clears a wrong code", async ({ page }) => {
  await signIn(page);
  await page.keyboard.type("12");
  await expect(box(page, 3)).toBeFocused();
  await page.keyboard.press("Backspace");
  await expect(box(page, 2)).toBeFocused();
  await expect(box(page, 2)).toHaveValue("");
  await page.keyboard.press("ArrowLeft");
  await expect(box(page, 1)).toBeFocused();
  await expect(box(page, 1)).toHaveValue("1");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(wrongCode().slice(1));
  await expect(page.locator(".rec-totp__error")).toHaveText("That code did not match. Check your app and try the newest code.");
  for (let n = 1; n <= 6; n += 1) await expect(box(page, n)).toHaveValue("");
  await expect(box(page, 1)).toBeFocused();
});

test("a pasted code fills every box and opens the page", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/protocols");
  await expect(page.getByRole("dialog")).toBeVisible();
  const code = authenticator.generate(secret);
  await box(page, 4).focus();
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, `${code.slice(0, 3)} - ${code.slice(3)}`);
  await expect(page).toHaveURL(/\/app\/protocols$/, { timeout: 15_000 });
  await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".rec-totp")).toHaveCount(0);
});

test("locks after five wrong tries", async ({ page }) => {
  await signIn(page);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect(box(page, 1)).toBeFocused();
    await page.keyboard.type(wrongCode());
    if (attempt < 4) await expect(page.locator(".rec-totp__error")).toContainText("did not match");
  }
  await expect(page.locator(".rec-totp__error")).toContainText(/Too many tries\. Wait \d+ seconds\./);
  await expect(box(page, 1)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Verify and continue" })).toBeDisabled();
});

test("fits at 390px with smaller boxes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const size = await box(page, 1).boundingBox();
  expect(Math.round(size?.width ?? 0)).toBe(44);
  expect(Math.round(size?.height ?? 0)).toBe(52);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const card = await page.getByRole("dialog").boundingBox();
  const last = await box(page, 6).boundingBox();
  expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual((card?.x ?? 0) + (card?.width ?? 0));
});
