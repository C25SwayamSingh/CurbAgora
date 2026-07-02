/**
 * Central route-access map shared by the proxy (`src/proxy.ts`, coarse
 * cookie-level checks) and by page-level server guards (full DB-backed
 * checks).
 *
 * The proxy is a convenience layer only; every protected page and server
 * action re-verifies authorization server-side via `src/lib/auth/guards.ts`
 * — never trust a redirect alone.
 */

export const GUEST_ONLY_PATHS = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
] as const;

export const AUTH_REQUIRED_PREFIXES = [
  "/onboarding",
  "/account",
  "/customer",
  "/vendor",
  "/admin",
  "/reset-password",
  "/mfa-enroll",
] as const;

export function isGuestOnlyPath(pathname: string): boolean {
  return GUEST_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function isAuthRequiredPath(pathname: string): boolean {
  return AUTH_REQUIRED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export const SIGN_IN_PATH = "/sign-in";
export const DEFAULT_AUTHED_PATH = "/onboarding";
