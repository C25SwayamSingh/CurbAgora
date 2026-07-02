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
  chooseAccountTypeAction,
  completeVendorProfileAction,
  signInAction,
  signUpAction,
  updateProfileAction,
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
      profile: { id: "user-1", account_type: "customer" },
    });

    const state = await updateProfileAction(
      idleState,
      form({
        displayName: "New Name",
        avatarUrl: "",
        // Attempted mass assignment — must be ignored:
        account_type: "vendor",
        onboarding_status: "complete",
        id: "someone-else",
      }),
    );

    expect(state.status).toBe("success");
    expect(client.update).toHaveBeenCalledTimes(1);
    expect(client.update).toHaveBeenCalledWith({
      display_name: "New Name",
      avatar_url: null,
    });
  });

  it("requires authentication", async () => {
    useSupabase({ user: null });
    await expect(
      updateProfileAction(idleState, form({ displayName: "X" })),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });
});

describe("chooseAccountTypeAction", () => {
  it("rejects values outside the enum", async () => {
    useSupabase({ user, profile: { id: "user-1", account_type: null } });
    const state = await chooseAccountTypeAction(
      idleState,
      form({ accountType: "admin" }),
    );
    expect(state.status).toBe("error");
  });

  it("refuses to change an already-set account type", async () => {
    useSupabase({
      user,
      profile: { id: "user-1", account_type: "customer" },
    });
    const state = await chooseAccountTypeAction(
      idleState,
      form({ accountType: "vendor" }),
    );
    expect(state.status).toBe("error");
    expect(state.message).toMatch(/already set/i);
  });

  it("routes vendors to the personal-profile step (not straight to org creation)", async () => {
    useSupabase({ user, profile: { id: "user-1", account_type: null } });
    await expect(
      chooseAccountTypeAction(idleState, form({ accountType: "vendor" })),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor/profile");
  });
});

describe("completeVendorProfileAction (vendor onboarding step 2)", () => {
  it("requires a vendor account", async () => {
    useSupabase({
      user,
      profile: { id: "user-1", account_type: "customer" },
    });
    const state = await completeVendorProfileAction(
      idleState,
      form({ displayName: "Maria" }),
    );
    expect(state.status).toBe("error");
  });

  it("saves the profile and routes to the mandatory MFA step, not org creation", async () => {
    const client = useSupabase({
      user,
      profile: { id: "user-1", account_type: "vendor" },
    });
    await expect(
      completeVendorProfileAction(
        idleState,
        form({
          displayName: "Maria",
          avatarUrl: "",
          // Attempted mass assignment — must be ignored:
          onboarding_status: "complete",
          account_type: "customer",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor/mfa");

    expect(client.update).toHaveBeenCalledWith({
      display_name: "Maria",
      avatar_url: null,
    });
  });
});
