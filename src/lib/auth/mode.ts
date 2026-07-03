import type { AuthContext } from "@/lib/auth/guards";
import type { PreferredMode } from "@/lib/supabase/database.types";

/** Vendor authorization: active organization membership only. */
export function hasVendorMembership(ctx: AuthContext): boolean {
  return ctx.memberships.length > 0;
}

/**
 * UI mode with safe fallback — preferred vendor mode without membership
 * falls back to customer (navigation only, not authorization).
 */
export function effectivePreferredMode(ctx: AuthContext): PreferredMode {
  const preferred = ctx.profile?.preferred_mode ?? "customer";
  if (preferred === "vendor" && !hasVendorMembership(ctx)) {
    return "customer";
  }
  return preferred;
}

/** Default signed-in destination after onboarding is complete. */
export function resolveDashboardPath(ctx: AuthContext): string {
  if (!ctx.profile || ctx.profile.onboarding_status !== "complete") {
    return "/onboarding";
  }
  if (effectivePreferredMode(ctx) === "vendor" && hasVendorMembership(ctx)) {
    return "/vendor";
  }
  return "/customer";
}

/** Whether basic profile onboarding is still required. */
export function needsBasicProfile(ctx: AuthContext): boolean {
  const name = ctx.profile?.display_name?.trim();
  return !name;
}
