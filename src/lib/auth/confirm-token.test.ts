import { describe, expect, it, vi } from "vitest";

import { confirmEmailToken } from "@/lib/auth/confirm-token";

function createSupabaseMock(options: {
  verifyError?: { message: string } | null;
  user?: { id: string } | null;
}) {
  const verifyOtp = vi.fn(async () => ({
    data: {},
    error: options.verifyError ?? null,
  }));

  return {
    auth: {
      verifyOtp,
      getUser: vi.fn(async () => ({
        data: { user: options.user ?? null },
        error: null,
      })),
    },
    verifyOtp,
  };
}

describe("confirmEmailToken", () => {
  it("verifies recovery tokens once and redirects to reset-password", async () => {
    const supabase = createSupabaseMock({ verifyError: null });

    const result = await confirmEmailToken(supabase as never, {
      tokenHash: "secret-hash",
      type: "recovery",
    });

    expect(result).toEqual({ pathname: "/reset-password" });
    expect(supabase.verifyOtp).toHaveBeenCalledTimes(1);
    expect(supabase.verifyOtp).toHaveBeenCalledWith({
      type: "recovery",
      token_hash: "secret-hash",
    });
  });

  it("reuses an existing recovery session when the token was already consumed", async () => {
    const supabase = createSupabaseMock({
      verifyError: { message: "invalid" },
      user: { id: "user-1" },
    });

    const result = await confirmEmailToken(supabase as never, {
      tokenHash: "used-hash",
      type: "recovery",
    });

    expect(result).toEqual({ pathname: "/reset-password" });
    expect(supabase.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it("returns a controlled recovery error for expired or invalid tokens", async () => {
    const supabase = createSupabaseMock({
      verifyError: { message: "invalid" },
      user: null,
    });

    const result = await confirmEmailToken(supabase as never, {
      tokenHash: "expired-hash",
      type: "recovery",
    });

    expect(result).toEqual({
      pathname: "/auth/error",
      flow: "recovery",
    });
  });

  it("sanitizes open-redirect next params for non-recovery flows", async () => {
    const supabase = createSupabaseMock({ verifyError: null });

    const result = await confirmEmailToken(supabase as never, {
      tokenHash: "signup-hash",
      type: "signup",
      next: "https://evil.example.com/phish",
    });

    expect(result).toEqual({ pathname: "/onboarding" });
  });
});
