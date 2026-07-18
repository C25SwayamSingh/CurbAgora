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
const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: createServerClientMock,
}));

import {
  createOrganizationAction,
  updateOrganizationAction,
} from "@/features/organizations/actions";
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

// Organization creation no longer requires MFA — these tests use an aal2
// session purely as a realistic default, not because it's required to reach
// the database call. Sensitive management actions after creation remain
// mandatory-MFA (see `requireVendorSensitiveAction` and its own tests).
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

  it("succeeds for a vendor with no MFA factor enrolled at all", async () => {
    const client = useSupabase({ user, profile: vendorProfile });
    await expect(
      createOrganizationAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.rpc).toHaveBeenCalled();
  });

  it("succeeds for an enrolled-but-unverified-this-session vendor", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      currentLevel: "aal1",
      nextLevel: "aal2",
    });
    await expect(
      createOrganizationAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.rpc).toHaveBeenCalled();
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

function membership(role: "owner" | "manager" | "staff") {
  return {
    id: "m-1",
    organization_id: "org-1",
    user_id: "user-1",
    role,
    status: "active" as const,
  };
}

describe("updateOrganizationAction", () => {
  it("requires authentication", async () => {
    useSupabase({ user: null });
    await expect(
      updateOrganizationAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("requires an aal2 (MFA-verified) session even for an owner", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      currentLevel: "aal1",
      nextLevel: "aal1",
    });
    await expect(
      updateOrganizationAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/mfa-enroll");
  });

  it("sends an aal1 owner with a verified factor to the MFA challenge, not straight through", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      currentLevel: "aal1",
      nextLevel: "aal2",
    });
    await expect(
      updateOrganizationAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/mfa-challenge");
  });

  it.each(["manager", "staff"] as const)(
    "blocks %s (owner-only)",
    async (role) => {
      const client = useSupabase({
        user,
        profile: vendorProfile,
        memberships: [membership(role)],
        ...aal2,
      });
      await expect(
        updateOrganizationAction(idleState, form(validForm)),
      ).rejects.toThrow("REDIRECT:/vendor");
      expect(client.organizationUpdate).not.toHaveBeenCalled();
    },
  );

  it("validates required fields server-side", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      ...aal2,
    });
    const state = await updateOrganizationAction(
      idleState,
      form({ ...validForm, displayName: "" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.displayName).toBeDefined();
    expect(client.organizationUpdate).not.toHaveBeenCalled();
  });

  it("updates only the caller's own organization, derived from membership", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      ...aal2,
    });
    const state = await updateOrganizationAction(
      idleState,
      form({
        ...validForm,
        // Attempted mass assignment — must never influence the update.
        organizationId: "someone-elses-org",
      }),
    );
    expect(state.status).toBe("success");
    expect(client.organizationUpdate).toHaveBeenCalledWith({
      legal_name: "Taco Cart LLC",
      display_name: "Taco Cart",
      slug: "taco-cart",
    });
  });

  it("surfaces a duplicate slug as a friendly field error", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      ...aal2,
      organizationUpdateError: { code: "23505", message: "duplicate key" },
    });
    const state = await updateOrganizationAction(idleState, form(validForm));
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.slug).toBeDefined();
  });

  it("returns a safe generic error for unexpected database failures", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      ...aal2,
      organizationUpdateError: { code: "42501", message: "permission denied" },
    });
    const state = await updateOrganizationAction(idleState, form(validForm));
    expect(state.status).toBe("error");
    expect(state.message).not.toMatch(/permission denied/i);
  });
});
