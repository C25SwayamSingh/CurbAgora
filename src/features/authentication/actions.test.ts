/**
 * Adversarial tests for the auth server actions: input validation, open
 * redirects, and mass-assignment of authorization fields.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockSupabase, type MockUserConfig } from "@/test/mock-supabase";

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
);
const createServerClientMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: createServerClientMock,
}));

import {
  cancelMfaEnrollmentAction,
  chooseOnboardingPathAction,
  completeVendorProfileAction,
  enrollMfaAction,
  setPreferredModeAction,
  signInAction,
  signUpAction,
  updateProfileAction,
  verifyMfaEnrollmentAction,
} from "@/features/authentication/actions";
import { idleState } from "@/features/authentication/action-state";

function useSupabase(config: MockUserConfig) {
  const client = createMockSupabase(config);
  createServerClientMock.mockResolvedValue(client);
  return client;
}

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

const user = { id: "user-1", email: "user@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signUpAction", () => {
  it("returns field errors for invalid input without calling Supabase", async () => {
    const client = useSupabase({ user: null });
    const state = await signUpAction(
      idleState,
      form({ displayName: "", email: "bad", password: "short" }),
    );

    expect(state.status).toBe("error");
    expect(state.fieldErrors?.displayName).toBeDefined();
    expect(state.fieldErrors?.email).toBeDefined();
    expect(state.fieldErrors?.password).toBeDefined();
    expect(client.auth.signUp).not.toHaveBeenCalled();
  });

  it("signs up and redirects to verify-email", async () => {
    const client = useSupabase({ user: null });
    await expect(
      signUpAction(
        idleState,
        form({
          displayName: "Maria",
          email: "maria@example.com",
          password: "a-strong-password",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/verify-email?email=maria%40example.com");

    expect(client.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "maria@example.com" }),
    );
  });
});

describe("signInAction (open redirect protection)", () => {
  it("sanitizes an absolute-URL next param to the fallback", async () => {
    useSupabase({ user });
    await expect(
      signInAction(
        idleState,
        form({
          email: "user@example.com",
          password: "pw",
          next: "https://evil.example.com/phish",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("sanitizes protocol-relative next params", async () => {
    useSupabase({ user });
    await expect(
      signInAction(
        idleState,
        form({
          email: "user@example.com",
          password: "pw",
          next: "//evil.example.com",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("keeps same-origin next paths", async () => {
    useSupabase({ user });
    await expect(
      signInAction(
        idleState,
        form({ email: "user@example.com", password: "pw", next: "/vendor" }),
      ),
    ).rejects.toThrow("REDIRECT:/vendor");
  });

  it("routes MFA-enrolled users to the challenge instead of the target", async () => {
    useSupabase({ user, currentLevel: "aal1", nextLevel: "aal2" });
    await expect(
      signInAction(
        idleState,
        form({ email: "user@example.com", password: "pw", next: "/vendor" }),
      ),
    ).rejects.toThrow("REDIRECT:/mfa-challenge?next=%2Fvendor");
  });

  it("returns a generic error for bad credentials", async () => {
    const client = useSupabase({ user });
    client.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", message: "nope" },
    });

    const state = await signInAction(
      idleState,
      form({ email: "user@example.com", password: "wrong" }),
    );
    expect(state.status).toBe("error");
    expect(state.message).toBe("Incorrect email or password.");
  });
});

describe("updateProfileAction (mass assignment protection)", () => {
  it("only writes whitelisted columns", async () => {
    const client = useSupabase({
      user,
      profile: {
        id: "user-1",
        preferred_mode: "customer",
      },
    });

    const state = await updateProfileAction(
      idleState,
      form({
        displayName: "New Name",
        account_type: "vendor",
        preferred_mode: "vendor",
        onboarding_status: "complete",
        id: "someone-else",
      }),
    );

    expect(state.status).toBe("success");
    expect(client.update).toHaveBeenCalledTimes(1);
    expect(client.update).toHaveBeenCalledWith({
      display_name: "New Name",
    });
  });

  it("requires authentication", async () => {
    useSupabase({ user: null });
    await expect(
      updateProfileAction(idleState, form({ displayName: "X" })),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });
});

describe("chooseOnboardingPathAction", () => {
  it("rejects values outside the enum", async () => {
    useSupabase({
      user,
      profile: { id: "user-1", preferred_mode: "customer" },
    });
    const state = await chooseOnboardingPathAction(
      idleState,
      form({ preferredMode: "admin" }),
    );
    expect(state.status).toBe("error");
  });

  it("routes vendors to the personal-profile step", async () => {
    useSupabase({
      user,
      profile: { id: "user-1", preferred_mode: "customer" },
    });
    await expect(
      chooseOnboardingPathAction(idleState, form({ preferredMode: "vendor" })),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor/profile");
  });

  it("routes customers to customer onboarding", async () => {
    useSupabase({
      user,
      profile: { id: "user-1", preferred_mode: "customer" },
    });
    await expect(
      chooseOnboardingPathAction(
        idleState,
        form({ preferredMode: "customer" }),
      ),
    ).rejects.toThrow("REDIRECT:/onboarding/customer");
  });

  it("persists preferred_mode and onboarding_status on success", async () => {
    const client = useSupabase({
      user,
      profile: { id: "user-1", preferred_mode: "customer" },
    });
    await expect(
      chooseOnboardingPathAction(
        idleState,
        form({ preferredMode: "customer" }),
      ),
    ).rejects.toThrow("REDIRECT:/onboarding/customer");
    expect(client.update).toHaveBeenCalledWith({
      preferred_mode: "customer",
      onboarding_status: "in_progress",
    });
  });

  it("allows changing path — onboarding is not permanently locked", async () => {
    useSupabase({
      user,
      profile: { id: "user-1", preferred_mode: "customer" },
    });
    await expect(
      chooseOnboardingPathAction(idleState, form({ preferredMode: "vendor" })),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor/profile");
  });
});

describe("setPreferredModeAction", () => {
  it("switches to customer interface", async () => {
    useSupabase({
      user,
      profile: { id: "user-1", preferred_mode: "vendor" },
      memberships: [
        {
          id: "m1",
          organization_id: "org-1",
          user_id: "user-1",
          role: "owner",
          status: "active",
        },
      ],
    });
    await expect(
      setPreferredModeAction(form({ preferredMode: "customer" })),
    ).rejects.toThrow("REDIRECT:/customer");
  });

  it("does not grant vendor access without membership", async () => {
    useSupabase({
      user,
      profile: {
        id: "user-1",
        preferred_mode: "customer",
        display_name: "Alex",
      },
    });
    await expect(
      setPreferredModeAction(form({ preferredMode: "vendor" })),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor/mfa");
  });
});

describe("completeVendorProfileAction (vendor onboarding step 2)", () => {
  it("saves the profile and routes to the mandatory MFA step", async () => {
    const client = useSupabase({
      user,
      profile: { id: "user-1", preferred_mode: "vendor" },
    });
    await expect(
      completeVendorProfileAction(
        idleState,
        form({
          displayName: "Maria",
          onboarding_status: "complete",
          preferred_mode: "customer",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor/mfa");

    expect(client.update).toHaveBeenCalledWith({
      display_name: "Maria",
      preferred_mode: "vendor",
    });
  });
});

describe("enrollMfaAction", () => {
  it("sweeps a stale unverified factor before enrolling a new one", async () => {
    const client = useSupabase({
      user,
      mfaFactors: [
        { id: "stale-1", factor_type: "totp", status: "unverified" },
      ],
    });

    const result = await enrollMfaAction();

    expect(client.auth.mfa.unenroll).toHaveBeenCalledWith({
      factorId: "stale-1",
    });
    expect(client.auth.mfa.enroll).toHaveBeenCalledWith({
      factorType: "totp",
    });
    expect(result.status).toBe("success");
    expect(result.factorId).toBe("factor-new");
  });

  it("leaves a verified factor alone", async () => {
    const client = useSupabase({
      user,
      mfaFactors: [{ id: "v-1", factor_type: "totp", status: "verified" }],
    });

    await enrollMfaAction();

    expect(client.auth.mfa.unenroll).not.toHaveBeenCalled();
    expect(client.auth.mfa.enroll).toHaveBeenCalled();
  });
});

describe("verifyMfaEnrollmentAction", () => {
  it("rejects a malformed code without calling Supabase", async () => {
    const client = useSupabase({ user });

    const state = await verifyMfaEnrollmentAction(
      idleState,
      form({ code: "abc", factorId: "factor-1" }),
    );

    expect(state.status).toBe("error");
    expect(state.fieldErrors?.code).toBeDefined();
    expect(client.auth.mfa.challenge).not.toHaveBeenCalled();
  });

  it("verifies a valid code and redirects to the provided next path", async () => {
    const client = useSupabase({ user });

    await expect(
      verifyMfaEnrollmentAction(
        idleState,
        form({
          code: "123456",
          factorId: "factor-1",
          next: "/onboarding/vendor",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor");

    expect(client.auth.mfa.challenge).toHaveBeenCalledWith({
      factorId: "factor-1",
    });
    expect(client.auth.mfa.verify).toHaveBeenCalledWith({
      factorId: "factor-1",
      challengeId: "challenge-1",
      code: "123456",
    });
  });

  it("returns a generic mismatch error when Supabase rejects the code", async () => {
    useSupabase({
      user,
      mfaVerifyError: { code: "invalid_code", message: "bad code" },
    });

    const state = await verifyMfaEnrollmentAction(
      idleState,
      form({ code: "123456", factorId: "factor-1" }),
    );

    expect(state.status).toBe("error");
    expect(state.fieldErrors?.code).toBeDefined();
  });
});

describe("cancelMfaEnrollmentAction", () => {
  it("unenrolls a matching unverified factor and redirects to next", async () => {
    const client = useSupabase({
      user,
      mfaFactors: [{ id: "f1", factor_type: "totp", status: "unverified" }],
    });

    await expect(
      cancelMfaEnrollmentAction(
        idleState,
        form({ factorId: "f1", next: "/onboarding/vendor/profile" }),
      ),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor/profile");

    expect(client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: "f1" });
  });

  it("does not unenroll a factor that is already verified", async () => {
    const client = useSupabase({
      user,
      mfaFactors: [{ id: "f1", factor_type: "totp", status: "verified" }],
    });

    await expect(
      cancelMfaEnrollmentAction(idleState, form({ factorId: "f1" })),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor/profile");

    expect(client.auth.mfa.unenroll).not.toHaveBeenCalled();
  });

  it("still redirects when the unenroll call fails (best-effort cleanup)", async () => {
    useSupabase({
      user,
      mfaFactors: [{ id: "f1", factor_type: "totp", status: "unverified" }],
      mfaUnenrollError: { code: "server_error", message: "boom" },
    });

    await expect(
      cancelMfaEnrollmentAction(idleState, form({ factorId: "f1" })),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor/profile");
  });

  it("redirects without calling unenroll when no factorId is provided", async () => {
    const client = useSupabase({ user });

    await expect(
      cancelMfaEnrollmentAction(idleState, form({})),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor/profile");

    expect(client.auth.mfa.unenroll).not.toHaveBeenCalled();
  });

  it("falls back to the vendor-profile step for an unsafe next path", async () => {
    useSupabase({ user });

    await expect(
      cancelMfaEnrollmentAction(idleState, form({ next: "//evil.com" })),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor/profile");
  });

  it("redirects to sign-in when unauthenticated", async () => {
    useSupabase({ user: null });

    await expect(
      cancelMfaEnrollmentAction(idleState, form({ factorId: "f1" })),
    ).rejects.toThrow(/^REDIRECT:\/sign-in/);
  });
});
