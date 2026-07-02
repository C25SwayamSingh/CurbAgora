import { test, expect } from "@playwright/test";

test("landing page shows value propositions and CTAs", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /For customers/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /For vendors/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Find Vendors/i })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /List Your Business/i }),
  ).toBeVisible();
});

test("Find Vendors navigates to discover placeholder", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Find Vendors/i }).click();

  await expect(page).toHaveURL("/discover");
  await expect(
    page.getByRole("heading", { name: /Find Vendors/i }),
  ).toBeVisible();
});

test("List Your Business navigates to vendor onboarding placeholder", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: /List Your Business/i }).click();

  await expect(page).toHaveURL("/vendors/list");
  await expect(
    page.getByRole("heading", { name: /List Your Business/i }),
  ).toBeVisible();
});
