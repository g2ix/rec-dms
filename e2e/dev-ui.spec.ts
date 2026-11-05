import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
