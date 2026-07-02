import { describe, expect, it } from "vitest";

import {
  forgotPasswordSchema,
  mfaCodeSchema,
  profileSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/features/authentication/schemas";

describe("signUpSchema", () => {
  it("accepts a valid sign-up", () => {
    const result = signUpSchema.safeParse({
      displayName: "Maria",
      email: "maria@example.com",
      password: "a-strong-password",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(
      signUpSchema.safeParse({
        displayName: "Maria",
        email: "not-an-email",
        password: "a-strong-password",
      }).success,
    ).toBe(false);
  });

  it("rejects short passwords", () => {
    expect(
      signUpSchema.safeParse({
        displayName: "Maria",
        email: "maria@example.com",
        password: "short",
      }).success,
    ).toBe(false);
  });

  it("rejects empty display names", () => {
    expect(
      signUpSchema.safeParse({
        displayName: "   ",
        email: "maria@example.com",
        password: "a-strong-password",
      }).success,
    ).toBe(false);
  });
});

describe("signInSchema", () => {
  it("requires both fields", () => {
    expect(signInSchema.safeParse({ email: "", password: "" }).success).toBe(
      false,
    );
    expect(
      signInSchema.safeParse({ email: "a@b.co", password: "x" }).success,
    ).toBe(true);
  });
});

describe("forgotPasswordSchema", () => {
  it("validates the email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(
      false,
    );
    expect(forgotPasswordSchema.safeParse({ email: "a@b.co" }).success).toBe(
      true,
    );
  });
});

describe("resetPasswordSchema", () => {
  it("requires matching passwords", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: "a-strong-password",
        confirmPassword: "different-password",
      }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        password: "a-strong-password",
        confirmPassword: "a-strong-password",
      }).success,
    ).toBe(true);
  });
});

describe("profileSchema", () => {
  it("allows empty avatar URL", () => {
    expect(
      profileSchema.safeParse({ displayName: "Maria", avatarUrl: "" }).success,
    ).toBe(true);
  });

  it("rejects non-https avatar URLs", () => {
    expect(
      profileSchema.safeParse({
        displayName: "Maria",
        avatarUrl: "http://insecure.example.com/pic.png",
      }).success,
    ).toBe(false);
    expect(
      profileSchema.safeParse({
        displayName: "Maria",
        avatarUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });
});

describe("mfaCodeSchema", () => {
  it("accepts exactly six digits", () => {
    expect(mfaCodeSchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(mfaCodeSchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(mfaCodeSchema.safeParse({ code: "abcdef" }).success).toBe(false);
    expect(mfaCodeSchema.safeParse({ code: "1234567" }).success).toBe(false);
  });
});
