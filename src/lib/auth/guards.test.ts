/**
 * Authorization test matrix for the server-side route guards.
 * Documented in docs/SECURITY_MODEL.md; database-level equivalents live in
 * supabase/tests/001_rls_policies.sql (pgTAP).
 *
 * Personas: anonymous, customer, vendor owner, vendor manager, vendor staff,
 * vendor without org, platform administrator, MFA-pending user.
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
  getAuthContext,
  requireAuth,
  requireCustomer,
  requireMfaSatisfied,
  requireOnboarded,
  requirePlatformAdmin,
  requireVendorDashboard,
  requireVendorForOrgCreation,
  requireVendorMember,
  requireVendorSensitiveAction,
  resolveVendorOnboardingPath,
} from "@/lib/auth/guards";

function useSupabase(config: MockUserConfig) {
  createServerClientMock.mockResolvedValue(createMockSupabase(config));
}

async function expectRedirect(promise: Promise<unknown>, url: string) {
  await expect(promise).rejects.toThrow(`REDIRECT:${url}`);
}

const baseUser = { id: "user-1", email: "user@example.com" };

const customerProfile = {
  id: "user-1",
  account_type: "customer" as const,
  onboarding_status: "complete" as const,
  display_name: "Customer",
};

const vendorProfile = {
  ...customerProfile,
  account_type: "vendor" as const,
  display_name: "Vendor",
};

function membership(role: "owner" | "manager" | "staff") {
  return {
    id: `m-${role}`,
    organization_id: "org-1",
    user_id: "user-1",
    role,
    status: "active" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("anonymous", () => {
  beforeEach(() => useSupabase({ user: null }));

  it("has no auth context", async () => {
    expect(await getAuthContext()).toBeNull();
  });

  it("is redirected to sign-in with a next param", async () => {
    await expectRedirect(requireAuth("/vendor"), "/sign-in?next=%2Fvendor");
  });

  it("cannot reach customer, vendor, or admin guards", async () => {
    await expectRedirect(requireCustomer(), "/sign-in");
    useSupabase({ user: null });
    await expectRedirect(requireVendorMember(), "/sign-in");
    useSupabase({ user: null });
    await expectRedirect(requirePlatformAdmin(), "/sign-in");
  });
});

describe("customer (onboarded)", () => {
  beforeEach(() => useSupabase({ user: baseUser, profile: customerProfile }));

  it("passes the customer guard", async () => {
    const ctx = await requireCustomer();
    expect(ctx.profile?.account_type).toBe("customer");
  });

  it("cannot access vendor areas (redirected to own dashboard)", async () => {
    await expectRedirect(requireVendorMember(), "/customer");
  });

  it("cannot access admin (redirected home)", async () => {
    await expectRedirect(requirePlatformAdmin(), "/");
  });
});

describe("incomplete onboarding", () => {
  it("is sent to onboarding before any dashboard", async () => {
    useSupabase({
      user: baseUser,
      profile: { ...customerProfile, onboarding_status: "in_progress" },
    });
    await expectRedirect(requireOnboarded(), "/onboarding");
  });

  it("handles a missing profile row the same way", async () => {
    useSupabase({ user: baseUser, profile: null });
    await expectRedirect(requireOnboarded(), "/onboarding");
  });
});

describe("vendor roles", () => {
  it("owner passes owner-restricted guards", async () => {
    useSupabase({
      user: baseUser,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    const ctx = await requireVendorMember(["owner"]);
    expect(ctx.membership.role).toBe("owner");
  });

  it("manager passes manager guards but not owner-only guards", async () => {
    useSupabase({
      user: baseUser,
      profile: vendorProfile,
      memberships: [membership("manager")],
    });
    const ctx = await requireVendorMember(["owner", "manager"]);
    expect(ctx.membership.role).toBe("manager");

    useSupabase({
      user: baseUser,
      profile: vendorProfile,
      memberships: [membership("manager")],
    });
    await expectRedirect(requireVendorMember(["owner"]), "/vendor");
  });

  it("staff cannot pass owner/manager guards", async () => {
    useSupabase({
      user: baseUser,
      profile: vendorProfile,
      memberships: [membership("staff")],
    });
    await expectRedirect(requireVendorMember(["owner", "manager"]), "/vendor");
  });

  it("vendor without an organization is sent to vendor onboarding", async () => {
    useSupabase({ user: baseUser, profile: vendorProfile, memberships: [] });
    await expectRedirect(requireVendorMember(), "/onboarding/vendor");
  });

  it("customer flipping frontend state still cannot pass vendor guard", async () => {
    // Even if the client claims vendor-ness, the guard reads account_type
    // and memberships from the database, so a customer is bounced.
    useSupabase({
      user: baseUser,
      profile: customerProfile,
      memberships: [],
    });
    await expectRedirect(requireVendorMember(["owner"]), "/customer");
  });
});

describe("MFA assurance", () => {
  it("redirects enrolled users at aal1 to the challenge page", async () => {
    useSupabase({
      user: baseUser,
      profile: customerProfile,
      currentLevel: "aal1",
      nextLevel: "aal2",
    });
    await expectRedirect(
      requireMfaSatisfied("/customer"),
      "/mfa-challenge?next=%2Fcustomer",
    );
  });

  it("passes aal2 sessions", async () => {
    useSupabase({
      user: baseUser,
      profile: customerProfile,
      currentLevel: "aal2",
      nextLevel: "aal2",
    });
    const ctx = await requireMfaSatisfied();
    expect(ctx.aal).toBe("aal2");
  });

  it("does not demand MFA from users who never enrolled", async () => {
    useSupabase({
      user: baseUser,
      profile: customerProfile,
      currentLevel: "aal1",
      nextLevel: "aal1",
    });
    const ctx = await requireMfaSatisfied();
    expect(ctx.mfaUpgradeRequired).toBe(false);
  });
});

describe("mandatory MFA for organization owners/managers", () => {
  describe("requireVendorForOrgCreation", () => {
    it("sends a vendor with no enrolled factor to MFA enrollment (not the challenge)", async () => {
      useSupabase({ user: baseUser, profile: vendorProfile });
      await expectRedirect(
        requireVendorForOrgCreation("/onboarding/vendor"),
        "/mfa-enroll?next=%2Fonboarding%2Fvendor",
      );
    });

    it("sends an enrolled-but-unverified vendor to the MFA challenge", async () => {
      useSupabase({
        user: baseUser,
        profile: vendorProfile,
        currentLevel: "aal1",
        nextLevel: "aal2",
      });
      await expectRedirect(
        requireVendorForOrgCreation("/onboarding/vendor"),
        "/mfa-challenge?next=%2Fonboarding%2Fvendor",
      );
    });

    it("passes for a fully MFA-verified vendor", async () => {
      useSupabase({
        user: baseUser,
        profile: vendorProfile,
        currentLevel: "aal2",
        nextLevel: "aal2",
      });
      const ctx = await requireVendorForOrgCreation();
      expect(ctx.aal).toBe("aal2");
    });

    it("still rejects a customer account regardless of MFA state", async () => {
      useSupabase({
        user: baseUser,
        profile: customerProfile,
        currentLevel: "aal2",
        nextLevel: "aal2",
      });
      await expectRedirect(requireVendorForOrgCreation(), "/customer");
    });
  });

  describe("requireVendorSensitiveAction", () => {
    it("owner with no enrolled factor is sent to MFA enrollment", async () => {
      useSupabase({
        user: baseUser,
        profile: vendorProfile,
        memberships: [membership("owner")],
      });
      await expectRedirect(
        requireVendorSensitiveAction(["owner"], "/vendor/settings"),
        "/mfa-enroll?next=%2Fvendor%2Fsettings",
      );
    });

    it("owner enrolled but at aal1 is sent to the MFA challenge", async () => {
      useSupabase({
        user: baseUser,
        profile: vendorProfile,
        memberships: [membership("owner")],
        currentLevel: "aal1",
        nextLevel: "aal2",
      });
      await expectRedirect(
        requireVendorSensitiveAction(["owner"], "/vendor/settings"),
        "/mfa-challenge?next=%2Fvendor%2Fsettings",
      );
    });

    it("owner at aal2 passes", async () => {
      useSupabase({
        user: baseUser,
        profile: vendorProfile,
        memberships: [membership("owner")],
        currentLevel: "aal2",
        nextLevel: "aal2",
      });
      const ctx = await requireVendorSensitiveAction(["owner"]);
      expect(ctx.membership.role).toBe("owner");
    });
  });

  describe("requireVendorDashboard", () => {
    it("owner without MFA cannot reach the dashboard", async () => {
      useSupabase({
        user: baseUser,
        profile: vendorProfile,
        memberships: [membership("owner")],
      });
      await expectRedirect(
        requireVendorDashboard(),
        "/mfa-enroll?next=%2Fvendor",
      );
    });

    it("manager without MFA cannot reach the dashboard", async () => {
      useSupabase({
        user: baseUser,
        profile: vendorProfile,
        memberships: [membership("manager")],
      });
      await expectRedirect(
        requireVendorDashboard(),
        "/mfa-enroll?next=%2Fvendor",
      );
    });

    it("staff without MFA can still reach the dashboard (MFA optional)", async () => {
      useSupabase({
        user: baseUser,
        profile: vendorProfile,
        memberships: [membership("staff")],
      });
      const ctx = await requireVendorDashboard();
      expect(ctx.membership.role).toBe("staff");
    });

    it("owner at aal2 reaches the dashboard", async () => {
      useSupabase({
        user: baseUser,
        profile: vendorProfile,
        memberships: [membership("owner")],
        currentLevel: "aal2",
        nextLevel: "aal2",
      });
      const ctx = await requireVendorDashboard();
      expect(ctx.membership.role).toBe("owner");
    });
  });

  describe("resolveVendorOnboardingPath", () => {
    it("sends a vendor with no organization and no aal2 session to the MFA step", async () => {
      useSupabase({ user: baseUser, profile: vendorProfile, memberships: [] });
      const ctx = await getAuthContext();
      expect(resolveVendorOnboardingPath(ctx!)).toBe("/onboarding/vendor/mfa");
    });

    it("sends a fully verified vendor with no organization to organization creation", async () => {
      useSupabase({
        user: baseUser,
        profile: vendorProfile,
        memberships: [],
        currentLevel: "aal2",
        nextLevel: "aal2",
      });
      const ctx = await getAuthContext();
      expect(resolveVendorOnboardingPath(ctx!)).toBe("/onboarding/vendor");
    });

    it("sends a vendor who already owns an organization straight to the dashboard", async () => {
      useSupabase({
        user: baseUser,
        profile: vendorProfile,
        memberships: [membership("owner")],
      });
      const ctx = await getAuthContext();
      expect(resolveVendorOnboardingPath(ctx!)).toBe("/vendor");
    });
  });
});

describe("platform administrator", () => {
  it("non-admin is rejected regardless of session strength", async () => {
    useSupabase({
      user: baseUser,
      profile: vendorProfile,
      isPlatformAdmin: false,
      currentLevel: "aal2",
      nextLevel: "aal2",
    });
    await expectRedirect(requirePlatformAdmin(), "/");
  });

  it("admin with aal2 session passes", async () => {
    useSupabase({
      user: baseUser,
      profile: customerProfile,
      isPlatformAdmin: true,
      currentLevel: "aal2",
      nextLevel: "aal2",
    });
    const ctx = await requirePlatformAdmin();
    expect(ctx.isPlatformAdmin).toBe(true);
  });

  it("admin with enrolled MFA at aal1 must complete the challenge", async () => {
    useSupabase({
      user: baseUser,
      profile: customerProfile,
      isPlatformAdmin: true,
      currentLevel: "aal1",
      nextLevel: "aal2",
    });
    await expectRedirect(
      requirePlatformAdmin("/admin"),
      "/mfa-challenge?next=%2Fadmin",
    );
  });

  it("admin without MFA enrollment is forced to security settings", async () => {
    useSupabase({
      user: baseUser,
      profile: customerProfile,
      isPlatformAdmin: true,
      currentLevel: "aal1",
      nextLevel: "aal1",
    });
    await expectRedirect(
      requirePlatformAdmin(),
      "/account/security?reason=admin-mfa-required",
    );
  });
});
