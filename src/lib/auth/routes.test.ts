import { describe, expect, it } from "vitest";

import { isAuthRequiredPath, isGuestOnlyPath } from "@/lib/auth/routes";

describe("route access map", () => {
  it("marks protected areas as auth-required", () => {
    for (const path of [
      "/onboarding",
      "/onboarding/customer",
      "/onboarding/vendor",
      "/account",
      "/account/security",
      "/customer",
      "/vendor",
      "/admin",
      "/reset-password",
      "/mfa-enroll",
    ]) {
      expect(isAuthRequiredPath(path), path).toBe(true);
    }
  });

  it("leaves public pages unprotected", () => {
    for (const path of [
      "/",
      "/discover",
      "/vendors/list",
      "/sign-in",
      "/sign-up",
      "/verify-email",
      "/auth/confirm",
    ]) {
      expect(isAuthRequiredPath(path), path).toBe(false);
    }
  });

  it("does not treat lookalike prefixes as protected", () => {
    expect(isAuthRequiredPath("/vendors")).toBe(false);
    expect(isAuthRequiredPath("/vendors/list")).toBe(false);
    expect(isAuthRequiredPath("/accounting")).toBe(false);
    expect(isAuthRequiredPath("/administrator")).toBe(false);
  });

  it("marks guest-only pages", () => {
    expect(isGuestOnlyPath("/sign-in")).toBe(true);
    expect(isGuestOnlyPath("/sign-up")).toBe(true);
    expect(isGuestOnlyPath("/forgot-password")).toBe(true);
    expect(isGuestOnlyPath("/reset-password")).toBe(false);
    expect(isGuestOnlyPath("/sign-in-fake")).toBe(false);
  });
});
