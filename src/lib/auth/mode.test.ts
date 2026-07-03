import { describe, expect, it } from "vitest";

import type { AuthContext } from "@/lib/auth/guards";
import {
  effectivePreferredMode,
  hasVendorMembership,
  resolveDashboardPath,
} from "@/lib/auth/mode";

const baseCtx = {
  user: { id: "u1", email: "a@b.com" } as AuthContext["user"],
  profile: {
    id: "u1",
    display_name: "Alex",
    avatar_url: null,
    account_type: "customer" as const,
    preferred_mode: "customer" as const,
    onboarding_status: "complete" as const,
    created_at: "",
    updated_at: "",
  },
  memberships: [],
  isPlatformAdmin: false,
  aal: "aal1" as const,
  mfaEnrolled: false,
  mfaUpgradeRequired: false,
} satisfies AuthContext;

describe("hasVendorMembership", () => {
  it("is false without active memberships", () => {
    expect(hasVendorMembership(baseCtx)).toBe(false);
  });

  it("is true with at least one membership", () => {
    expect(
      hasVendorMembership({
        ...baseCtx,
        memberships: [
          {
            id: "m1",
            organization_id: "o1",
            user_id: "u1",
            role: "owner",
            status: "active",
            invited_by: null,
            created_at: "",
            updated_at: "",
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("effectivePreferredMode", () => {
  it("falls back to customer when vendor mode has no membership", () => {
    expect(
      effectivePreferredMode({
        ...baseCtx,
        profile: { ...baseCtx.profile!, preferred_mode: "vendor" },
      }),
    ).toBe("customer");
  });

  it("keeps vendor mode when membership exists", () => {
    expect(
      effectivePreferredMode({
        ...baseCtx,
        profile: { ...baseCtx.profile!, preferred_mode: "vendor" },
        memberships: [
          {
            id: "m1",
            organization_id: "o1",
            user_id: "u1",
            role: "staff",
            status: "active",
            invited_by: null,
            created_at: "",
            updated_at: "",
          },
        ],
      }),
    ).toBe("vendor");
  });
});

describe("resolveDashboardPath", () => {
  it("sends incomplete users to onboarding", () => {
    expect(
      resolveDashboardPath({
        ...baseCtx,
        profile: { ...baseCtx.profile!, onboarding_status: "in_progress" },
      }),
    ).toBe("/onboarding");
  });

  it("sends vendor members with vendor preference to /vendor", () => {
    expect(
      resolveDashboardPath({
        ...baseCtx,
        profile: { ...baseCtx.profile!, preferred_mode: "vendor" },
        memberships: [
          {
            id: "m1",
            organization_id: "o1",
            user_id: "u1",
            role: "owner",
            status: "active",
            invited_by: null,
            created_at: "",
            updated_at: "",
          },
        ],
      }),
    ).toBe("/vendor");
  });

  it("does not grant vendor dashboard from preferred mode alone", () => {
    expect(
      resolveDashboardPath({
        ...baseCtx,
        profile: { ...baseCtx.profile!, preferred_mode: "vendor" },
      }),
    ).toBe("/customer");
  });
});
