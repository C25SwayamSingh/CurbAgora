import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Clears the Supabase session cookie, then redirects to a safe same-origin path.
 * Used from auth error/recovery flows so "Sign in" never reuses a stale session.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  await supabase.auth.signOut();

  const next = safeNextPath(
    request.nextUrl.searchParams.get("next"),
    "/sign-in",
  );

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = next;
  redirectTo.search = "";

  const reset = request.nextUrl.searchParams.get("reset");
  if (reset) {
    redirectTo.searchParams.set("reset", reset);
  }

  return NextResponse.redirect(redirectTo);
}
