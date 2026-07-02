import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { getPublicSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_AUTHED_PATH,
  SIGN_IN_PATH,
  isAuthRequiredPath,
  isGuestOnlyPath,
} from "@/lib/auth/routes";

/**
 * Auth proxy (Next.js 16 replacement for `middleware.ts`): refreshes the
 * Supabase session cookie on every request and applies coarse route guards
 * (signed-in vs signed-out).
 *
 * This is intentionally only a convenience layer — it is NOT the source of
 * truth for authorization. Role, onboarding, MFA/AAL, and admin checks are
 * independently re-enforced server-side in each page/action via
 * `src/lib/auth/guards.ts`, and ultimately by RLS + AAL checks in the
 * database. A bug or bypass here can at most cause an inconvenient redirect,
 * never a data-access decision.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // In development without Supabase configured, skip the network call and
  // treat every request as signed out (guards still apply). In production
  // getPublicSupabaseEnv() below fails fast instead.
  const devWithoutSupabase =
    process.env.NODE_ENV === "development" && !isSupabaseConfigured();

  let user: unknown = null;

  if (!devWithoutSupabase) {
    const { url, anonKey } = getPublicSupabaseEnv();

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    // getUser() validates the JWT against the auth server (and refreshes
    // expired sessions); never trust getSession() here.
    const {
      data: { user: verifiedUser },
    } = await supabase.auth.getUser();
    user = verifiedUser;
  }

  const { pathname } = request.nextUrl;

  if (!user && isAuthRequiredPath(pathname)) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = SIGN_IN_PATH;
    signInUrl.search = "";
    signInUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signInUrl);
  }

  if (user && isGuestOnlyPath(pathname)) {
    const authedUrl = request.nextUrl.clone();
    authedUrl.pathname = DEFAULT_AUTHED_PATH;
    authedUrl.search = "";
    return NextResponse.redirect(authedUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
