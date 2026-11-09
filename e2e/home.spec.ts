import { expect, test } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("REC-DMS · University of San Carlos Research Ethics Committee");
  await expect(page.getByRole("heading", { level: 1, name: "Research Ethics Committee" })).toBeVisible();
  await expect(page.getByText(/see where it stands at every step/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in with your USC account" })).toHaveAttribute("href", "/sign-in");
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up");
});

test("home page fits a phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  await expect(page.getByRole("navigation", { name: "On this page" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
});
