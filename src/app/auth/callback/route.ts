import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { createServerClient } from "@/lib/supabase/server";

/**
 * PKCE code exchange callback (used when auth links carry a `code` param).
 * `next` is validated against same-origin paths to prevent open redirects.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), "/onboarding");

  const redirectTo = request.nextUrl.clone();
  redirectTo.search = "";

  const supabase = await createServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirectTo.pathname = next;
      return NextResponse.redirect(redirectTo);
    }
  }

  // The PKCE code is single-use. Email clients or extra tabs often hit this
  // route again after the first exchange already succeeded in this browser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirectTo.pathname = next;
    return NextResponse.redirect(redirectTo);
  }

  redirectTo.pathname = "/auth/error";
  if (next === "/reset-password") {
    redirectTo.searchParams.set("flow", "recovery");
  }
  return NextResponse.redirect(redirectTo);
}
