import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { hasVendorMembership, resolveDashboardPath } from "@/lib/auth/mode";
import type {
  OrganizationMember,
  OrganizationRole,
  Profile,
} from "@/lib/supabase/database.types";
import { createServerClient } from "@/lib/supabase/server";
import { SIGN_IN_PATH } from "@/lib/auth/routes";

export type AuthenticatorAssuranceLevel = "aal1" | "aal2";

export type AuthContext = {
  user: User;
  profile: Profile | null;
  /** Active memberships only. */
  memberships: OrganizationMember[];
  isPlatformAdmin: boolean;
  /** Assurance level of the current session, verified server-side. */
  aal: AuthenticatorAssuranceLevel;
  /** True when the user has at least one verified MFA factor. */
  mfaEnrolled: boolean;
  /** True when the user has a verified MFA factor but this session is aal1. */
  mfaUpgradeRequired: boolean;
};

/** Roles for which MFA enrollment + verification is mandatory (not optional). */
const MFA_MANDATORY_ROLES: OrganizationRole[] = ["owner", "manager"];

export function isMfaMandatoryRole(role: OrganizationRole): boolean {
  return MFA_MANDATORY_ROLES.includes(role);
}

export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const [profileResult, membershipsResult, adminResult, aalResult] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase
        .from("organization_members")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "active"),
      supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);

  const aal =
    aalResult.data?.currentLevel === "aal2"
      ? ("aal2" as const)
      : ("aal1" as const);
  const mfaEnrolled = aalResult.data?.nextLevel === "aal2";
  const mfaUpgradeRequired = mfaEnrolled && aal !== "aal2";

  if (profileResult.error) {
    console.error("profile load failed", {
      code: profileResult.error.code,
      userId: user.id,
    });
  }

  return {
    user,
    profile: profileResult.data ?? null,
    memberships: membershipsResult.data ?? [],
    isPlatformAdmin: Boolean(adminResult.data),
    aal,
    mfaEnrolled,
    mfaUpgradeRequired,
  };
});

function signInRedirect(nextPath?: string): never {
  const target = nextPath
    ? `${SIGN_IN_PATH}?next=${encodeURIComponent(nextPath)}`
    : SIGN_IN_PATH;
  redirect(target);
}

function redirectToMfaStep(ctx: AuthContext, nextPath?: string): never {
  const step = ctx.mfaEnrolled ? "/mfa-challenge" : "/mfa-enroll";
  redirect(nextPath ? `${step}?next=${encodeURIComponent(nextPath)}` : step);
}

export function enforceMfaVerified(ctx: AuthContext, nextPath?: string): void {
  if (ctx.aal !== "aal2") {
    redirectToMfaStep(ctx, nextPath);
  }
}

export async function requireAuth(nextPath?: string): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    signInRedirect(nextPath);
  }
  return ctx;
}

export async function requireMfaSatisfied(
  nextPath?: string,
): Promise<AuthContext> {
  const ctx = await requireAuth(nextPath);
  if (ctx.mfaUpgradeRequired) {
    redirect(
      nextPath
        ? `/mfa-challenge?next=${encodeURIComponent(nextPath)}`
        : "/mfa-challenge",
    );
  }
  return ctx;
}

/** Require completed onboarding; otherwise send the user to /onboarding. */
export async function requireOnboarded(
  nextPath?: string,
): Promise<AuthContext> {
  const ctx = await requireMfaSatisfied(nextPath);
  if (!ctx.profile || ctx.profile.onboarding_status !== "complete") {
    redirect("/onboarding");
  }
  return ctx;
}

/**
 * Customer interface — any onboarded user may browse customer mode,
 * including vendor members switching UI context.
 */
export async function requireCustomer(nextPath?: string): Promise<AuthContext> {
  return requireOnboarded(nextPath);
}

export type VendorContext = AuthContext & {
  membership: OrganizationMember;
};

/**
 * Vendor authorization: active organization membership only.
 * preferred_mode and account_type are never checked here.
 */
export async function requireVendorMember(
  allowedRoles?: OrganizationRole[],
  nextPath?: string,
): Promise<VendorContext> {
  const ctx = await requireMfaSatisfied(nextPath);

  if (ctx.memberships.length === 0) {
    redirect("/onboarding/vendor");
  }

  const membership = ctx.memberships.find(
    (m) => !allowedRoles || allowedRoles.includes(m.role),
  );

  if (!membership) {
    redirect("/vendor");
  }

  return { ...ctx, membership };
}

/** Resume vendor onboarding: profile → MFA → organization creation. */
export function resolveVendorOnboardingPath(ctx: AuthContext): string {
  if (hasVendorMembership(ctx)) {
    return "/vendor";
  }
  const displayName = ctx.profile?.display_name?.trim();
  if (!displayName) {
    return "/onboarding/vendor/profile";
  }
  if (ctx.aal !== "aal2") {
    return "/onboarding/vendor/mfa";
  }
  return "/onboarding/vendor";
}

export async function requireVendorForOrgCreation(
  nextPath?: string,
): Promise<AuthContext> {
  const ctx = await requireAuth(nextPath);
  enforceMfaVerified(ctx, nextPath);
  return ctx;
}

export async function requireVendorSensitiveAction(
  allowedRoles?: OrganizationRole[],
  nextPath?: string,
): Promise<VendorContext> {
  const ctx = await requireVendorMember(allowedRoles, nextPath);
  enforceMfaVerified(ctx, nextPath);
  return ctx;
}

export async function requireVendorDashboard(
  nextPath = "/vendor",
): Promise<VendorContext> {
  const ctx = await requireVendorMember(undefined, nextPath);
  if (isMfaMandatoryRole(ctx.membership.role)) {
    enforceMfaVerified(ctx, nextPath);
  }
  return ctx;
}

export async function requirePlatformAdmin(
  nextPath?: string,
): Promise<AuthContext> {
  const ctx = await requireAuth(nextPath);
  if (!ctx.isPlatformAdmin) {
    redirect("/");
  }
  if (ctx.mfaUpgradeRequired) {
    redirect(
      nextPath
        ? `/mfa-challenge?next=${encodeURIComponent(nextPath)}`
        : "/mfa-challenge",
    );
  }
  if (ctx.aal !== "aal2") {
    redirect("/account/security?reason=admin-mfa-required");
  }
  return ctx;
}

/** Post-login / post-onboarding routing using preferred mode + membership. */
export { hasVendorMembership, resolveDashboardPath };
