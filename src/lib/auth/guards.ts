import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";

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

/**
 * Load the authenticated user plus authorization context for this request.
 * Uses supabase.auth.getUser() (server-verified against the auth server),
 * never the unverified session payload. Cached per request.
 *
 * Returns null when there is no valid session.
 */
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
  // nextLevel === "aal2" means the user has at least one verified factor
  // (the highest level they could reach), regardless of this session's
  // current level.
  const mfaEnrolled = aalResult.data?.nextLevel === "aal2";
  const mfaUpgradeRequired = mfaEnrolled && aal !== "aal2";

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

/**
 * Redirect to the appropriate MFA step for a session that is not yet aal2:
 * `/mfa-enroll` when no verified factor exists yet, `/mfa-challenge` when a
 * factor is enrolled but this session has not verified it. Used wherever
 * MFA is mandatory (not merely "if enrolled") — organization owners/managers
 * performing sensitive actions and platform administrators.
 */
function redirectToMfaStep(ctx: AuthContext, nextPath?: string): never {
  const step = ctx.mfaEnrolled ? "/mfa-challenge" : "/mfa-enroll";
  redirect(nextPath ? `${step}?next=${encodeURIComponent(nextPath)}` : step);
}

/**
 * Assert that an already-loaded auth context is fully MFA-verified (aal2),
 * redirecting to the enrollment or challenge step otherwise. Exported so
 * server actions that already hold a context (from `requireAuth()` or
 * similar) can independently re-verify aal2 immediately before a sensitive
 * write, without an extra round-trip to reload the context.
 */
export function enforceMfaVerified(ctx: AuthContext, nextPath?: string): void {
  if (ctx.aal !== "aal2") {
    redirectToMfaStep(ctx, nextPath);
  }
}

/** Require a signed-in user; redirect to sign-in otherwise. */
export async function requireAuth(nextPath?: string): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    signInRedirect(nextPath);
  }
  return ctx;
}

/**
 * Require a signed-in user whose session satisfies MFA: if the user has a
 * verified TOTP factor, the session must be aal2. Applies to all protected
 * areas so a stolen password alone never grants access once MFA is enrolled.
 */
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

/** Require a customer account (onboarded). */
export async function requireCustomer(nextPath?: string): Promise<AuthContext> {
  const ctx = await requireOnboarded(nextPath);
  if (ctx.profile?.account_type !== "customer") {
    redirect(
      ctx.profile?.account_type === "vendor" ? "/vendor" : "/onboarding",
    );
  }
  return ctx;
}

export type VendorContext = AuthContext & {
  membership: OrganizationMember;
};

/**
 * Require an active membership in at least one organization, optionally
 * restricted to specific roles. Roles come from the database via RLS-guarded
 * queries — never from client input.
 */
export async function requireVendorMember(
  allowedRoles?: OrganizationRole[],
  nextPath?: string,
): Promise<VendorContext> {
  const ctx = await requireOnboarded(nextPath);
  if (ctx.profile?.account_type !== "vendor") {
    redirect(
      ctx.profile?.account_type === "customer" ? "/customer" : "/onboarding",
    );
  }

  const membership = ctx.memberships.find(
    (m) => !allowedRoles || allowedRoles.includes(m.role),
  );

  if (!membership) {
    // Vendor account without a (sufficient) membership: back to onboarding
    // (no org yet) or their dashboard (insufficient role).
    redirect(ctx.memberships.length === 0 ? "/onboarding/vendor" : "/vendor");
  }

  return { ...ctx, membership };
}

/**
 * Resolve which step of the vendor onboarding sequence a vendor account
 * should resume at: MFA enroll/verify (mandatory) before organization
 * creation, or the organization-creation step once MFA is verified. Does
 * not distinguish enroll vs. challenge — the MFA step page/guards do that.
 */
export function resolveVendorOnboardingPath(ctx: AuthContext): string {
  if (ctx.memberships.length > 0) {
    return "/vendor";
  }
  if (ctx.aal !== "aal2") {
    return "/onboarding/vendor/mfa";
  }
  return "/onboarding/vendor";
}

/**
 * Require an active vendor account (no organization membership required
 * yet) with a fully MFA-verified (aal2) session. Used for the vendor
 * onboarding step that creates the organization: MFA must be enrolled and
 * verified BEFORE an organization (and its owner membership) can be
 * created — there is no membership to check yet at this point, so this is
 * intentionally distinct from `requireVendorSensitiveAction`.
 */
export async function requireVendorForOrgCreation(
  nextPath?: string,
): Promise<AuthContext> {
  const ctx = await requireAuth(nextPath);
  if (ctx.profile?.account_type !== "vendor") {
    redirect(
      ctx.profile?.account_type === "customer" ? "/customer" : "/onboarding",
    );
  }
  enforceMfaVerified(ctx, nextPath);
  return ctx;
}

/**
 * Require active membership in an allowed role AND a fully MFA-verified
 * (aal2) session, unconditionally — not merely "if enrolled" like
 * `requireMfaSatisfied`. Use this for every sensitive vendor write:
 * updating organization settings, inviting/adding/removing members,
 * assigning or removing manager/owner roles, and (when built) loyalty
 * configuration, customer-data access, and billing administration.
 *
 * Frontend redirects here are a convenience only — the corresponding
 * server actions must independently call this guard (or check `ctx.aal`)
 * before writing, and the database independently requires an aal2 JWT via
 * restrictive RLS policies. See docs/SECURITY_MODEL.md.
 */
export async function requireVendorSensitiveAction(
  allowedRoles?: OrganizationRole[],
  nextPath?: string,
): Promise<VendorContext> {
  const ctx = await requireVendorMember(allowedRoles, nextPath);
  enforceMfaVerified(ctx, nextPath);
  return ctx;
}

/**
 * Require active vendor membership for the dashboard shell. Owners and
 * managers must have a fully MFA-verified session to reach it (MFA is
 * mandatory for leadership roles, including existing owners/managers who
 * predate this requirement); staff access is unaffected (MFA optional).
 */
export async function requireVendorDashboard(
  nextPath = "/vendor",
): Promise<VendorContext> {
  const ctx = await requireVendorMember(undefined, nextPath);
  if (isMfaMandatoryRole(ctx.membership.role)) {
    enforceMfaVerified(ctx, nextPath);
  }
  return ctx;
}

/**
 * Require a platform administrator with an MFA-verified (aal2) session.
 * Admin status comes from the platform_admins table (RLS self-read), which
 * is only writable via migrations or the service role — never from profile
 * fields, URL params, or client state.
 */
export async function requirePlatformAdmin(
  nextPath?: string,
): Promise<AuthContext> {
  const ctx = await requireAuth(nextPath);
  if (!ctx.isPlatformAdmin) {
    redirect("/");
  }
  // Admins MUST use MFA: an admin without an enrolled factor is sent to
  // security settings to enroll; an enrolled admin at aal1 must challenge.
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
