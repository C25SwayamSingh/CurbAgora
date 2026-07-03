/**
 * Adversarial tests for organization creation: vendor-only access,
 * duplicate-owner idempotency, validation, and that role/org values are
 * never taken from the client.
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

import { createOrganizationAction } from "@/features/organizations/actions";
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

const user = { id: "user-1", email: "vendor@example.com" };
const vendorProfile = {
  id: "user-1",
  account_type: "vendor" as const,
  onboarding_status: "in_progress" as const,
};

const validForm = {
  legalName: "Taco Cart LLC",
  displayName: "Taco Cart",
  slug: "taco-cart",
};

// Organization creation is a sensitive, mandatory-MFA action: tests that
// reach the database call must simulate a fully MFA-verified (aal2)
// session, exactly like `requireVendorForOrgCreation` requires in practice.
const aal2 = { currentLevel: "aal2" as const, nextLevel: "aal2" as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createOrganizationAction", () => {
  it("requires authentication", async () => {
    useSupabase({ user: null });
    await expect(
      createOrganizationAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("allows customer accounts when MFA is verified", async () => {
    const client = useSupabase({
      user,
      profile: { ...vendorProfile, account_type: "customer" },
      ...aal2,
    });
    await expect(
      createOrganizationAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.rpc).toHaveBeenCalled();
  });

  it("is idempotent: existing owners are redirected, not duplicated", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [
        {
          id: "m-1",
          organization_id: "org-1",
          user_id: "user-1",
          role: "owner",
          status: "active",
        },
      ],
    });
    await expect(
      createOrganizationAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("requires a fully MFA-verified session, even for a vendor with the right role (no factor enrolled)", async () => {
    const client = useSupabase({ user, profile: vendorProfile });
    await expect(
      createOrganizationAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/mfa-enroll?next=%2Fonboarding%2Fvendor");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("sends an enrolled-but-unverified vendor to the MFA challenge, not straight through", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      currentLevel: "aal1",
      nextLevel: "aal2",
    });
    await expect(
      createOrganizationAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/mfa-challenge?next=%2Fonboarding%2Fvendor");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("validates the slug server-side", async () => {
    const client = useSupabase({ user, profile: vendorProfile, ...aal2 });
    const state = await createOrganizationAction(
      idleState,
      form({ ...validForm, slug: "Bad Slug!!" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.slug).toBeDefined();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("calls the atomic DB function with only name/slug values", async () => {
    const client = useSupabase({ user, profile: vendorProfile, ...aal2 });
    await expect(
      createOrganizationAction(
        idleState,
        form({
          ...validForm,
          // Attempted mass assignment — must never reach the database:
          role: "owner",
          user_id: "someone-else",
          organization_id: "org-x",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/vendor");

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("create_organization_with_owner", {
      p_legal_name: "Taco Cart LLC",
      p_display_name: "Taco Cart",
      p_slug: "taco-cart",
    });
  });

  it("surfaces slug collisions as a friendly field error", async () => {
    const client = useSupabase({ user, profile: vendorProfile, ...aal2 });
    client.rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });

    const state = await createOrganizationAction(idleState, form(validForm));
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.slug).toBeDefined();
  });
});
