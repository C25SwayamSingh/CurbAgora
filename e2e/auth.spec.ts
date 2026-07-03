import { test, expect } from "@playwright/test";

/**
 * Auth flow E2E tests that run without a live Supabase backend:
 * route protection (proxy redirects), form rendering, client-visible
 * validation from server actions, and open-redirect sanitization.
 * Full sign-up/sign-in journeys require a local Supabase stack (see README).
 */

test.describe("route protection (unauthenticated)", () => {
  for (const path of [
    "/onboarding",
    "/onboarding/customer",
    "/onboarding/vendor",
    "/onboarding/vendor/profile",
    "/onboarding/vendor/mfa",
    "/account",
    "/account/security",
    "/customer",
    "/vendor",
    "/admin",
    "/mfa-enroll",
  ]) {
    test(`redirects ${path} to sign-in with next param`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(
        new RegExp(`/sign-in\\?next=${encodeURIComponent(path)}`),
      );
      await expect(
        page.getByRole("heading", { name: /welcome back/i }),
      ).toBeVisible();
    });
  }
});

test.describe("auth pages", () => {
  test("sign-up form renders accessible fields", async ({ page }) => {
    await page.goto("/sign-up");

    await expect(page.getByLabel(/display name/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /create account/i }),
    ).toBeVisible();
  });

  test("sign-up shows server-side validation errors", async ({ page }) => {
    await page.goto("/sign-up");

    await page.getByLabel(/display name/i).fill("Maria");
    await page.getByLabel(/email/i).fill("not-an-email");
    await page.getByLabel(/^password$/i).fill("short");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.getByText(/fix the highlighted fields/i)).toBeVisible();
    await expect(page.getByText(/valid email address/i)).toBeVisible();
    await expect(
      page.getByText(/at least 10 characters/i).first(),
    ).toBeVisible();
  });

  test("password visibility toggle works", async ({ page }) => {
    await page.goto("/sign-in");

    const password = page.getByLabel(/^password$/i);
    await password.fill("secret-value");
    await expect(password).toHaveAttribute("type", "password");

    // Retry the click until hydration has attached the handler.
    await expect(async () => {
      await page.getByRole("button", { name: /show password/i }).click();
      await expect(password).toHaveAttribute("type", "text", { timeout: 500 });
    }).toPass();
  });

  test("forgot-password validates email server-side", async ({ page }) => {
    await page.goto("/forgot-password");

    await page.getByLabel(/email/i).fill("nope");
    await page.getByRole("button", { name: /send reset link/i }).click();

    await expect(page.getByText(/valid email address/i)).toBeVisible();
  });

  test("verify-email page renders", async ({ page }) => {
    await page.goto("/verify-email?email=someone%40example.com");
    await expect(
      page.getByRole("heading", { name: /check your inbox/i }),
    ).toBeVisible();
    await expect(page.getByText(/someone@example.com/)).toBeVisible();
  });

  test("landing page shows CurbAgora branding", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("CurbAgora").first()).toBeVisible();
  });

  test("sign-in form uses password-manager autocomplete attributes", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await expect(page.getByLabel(/email/i)).toHaveAttribute(
      "autocomplete",
      "username",
    );
    await expect(page.getByLabel(/^password$/i)).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  test("sign-up form uses password-manager autocomplete attributes", async ({
    page,
  }) => {
    await page.goto("/sign-up");
    await expect(page.getByLabel(/email/i)).toHaveAttribute(
      "autocomplete",
      "username",
    );
    await expect(page.getByLabel(/^password$/i)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });
});

test.describe("open redirect protection", () => {
  test("absolute-URL next params are not propagated to the form", async ({
    page,
  }) => {
    await page.goto("/sign-in?next=https%3A%2F%2Fevil.example.com%2Fphish");

    const hiddenNext = page.locator('input[name="next"]');
    await expect(hiddenNext).toHaveValue("/onboarding");
  });

  test("protocol-relative next params are sanitized", async ({ page }) => {
    await page.goto("/sign-in?next=%2F%2Fevil.example.com");

    const hiddenNext = page.locator('input[name="next"]');
    await expect(hiddenNext).toHaveValue("/onboarding");
  });

  test("same-origin next params are preserved", async ({ page }) => {
    await page.goto("/sign-in?next=%2Fvendor");

    const hiddenNext = page.locator('input[name="next"]');
    await expect(hiddenNext).toHaveValue("/vendor");
  });

  test("expired/invalid auth links land on the error page", async ({
    page,
  }) => {
    await page.goto("/auth/confirm?token_hash=bogus&type=signup");
    await expect(page).toHaveURL(/\/auth\/error$/);
    await expect(
      page.getByRole("heading", { name: /this link isn.t valid anymore/i }),
    ).toBeVisible();
  });

  test("recovery interstitial verifies via same-tab POST form", async ({
    page,
  }) => {
    await page.goto("/auth/recovery?token_hash=test-token&type=recovery");

    const form = page.locator('form[action="/auth/confirm"][method="POST"]');
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="token_hash"]')).toHaveValue(
      "test-token",
    );
    await expect(form.locator('input[name="type"]')).toHaveValue("recovery");

    const button = page.getByRole("button", {
      name: /continue to reset password/i,
    });
    await expect(button).not.toHaveAttribute("target", "_blank");
  });
});
