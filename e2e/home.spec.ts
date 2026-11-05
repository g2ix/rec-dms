import { expect, test } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "USC REC-DMS" })).toBeVisible();
  await expect(page.getByText(/email-and-Word submission process/)).toBeVisible();
});
