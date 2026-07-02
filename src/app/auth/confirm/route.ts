import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { safeNextPath } from "@/lib/auth/redirect";
import { createServerClient } from "@/lib/supabase/server";

const ALLOWED_OTP_TYPES: EmailOtpType[] = [
  "signup",
  "email",
  "recovery",
  "email_change",
];

/**
 * Verifies email-link tokens (sign-up confirmation, password recovery,
 * email change). The `next` param is validated against same-origin paths
 * to prevent open redirects.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"), "/onboarding");

  const redirectTo = request.nextUrl.clone();
  redirectTo.search = "";

  if (tokenHash && type && ALLOWED_OTP_TYPES.includes(type)) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      redirectTo.pathname = type === "recovery" ? "/reset-password" : next;
      return NextResponse.redirect(redirectTo);
    }
  }

  redirectTo.pathname = "/auth/error";
  return NextResponse.redirect(redirectTo);
}
