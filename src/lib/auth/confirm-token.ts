import type { EmailOtpType, SupabaseClient } from "@supabase/supabase-js";

import { safeNextPath } from "@/lib/auth/redirect";

export const ALLOWED_EMAIL_OTP_TYPES: EmailOtpType[] = [
  "signup",
  "email",
  "recovery",
  "email_change",
];

export type ConfirmTokenInput = {
  tokenHash: string | null;
  type: EmailOtpType | null;
  next?: string | null;
};

export type ConfirmTokenResult = {
  pathname: string;
  flow?: "recovery";
};

/**
 * Verifies an email OTP token once and returns the safe redirect destination.
 * Does not log token values.
 */
export async function confirmEmailToken(
  supabase: SupabaseClient,
  input: ConfirmTokenInput,
): Promise<ConfirmTokenResult> {
  const { tokenHash, type } = input;
  const next = safeNextPath(input.next ?? null, "/onboarding");

  if (tokenHash && type && ALLOWED_EMAIL_OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      return {
        pathname: type === "recovery" ? "/reset-password" : next,
      };
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && type === "recovery") {
    return { pathname: "/reset-password" };
  }

  return {
    pathname: "/auth/error",
    flow: type === "recovery" ? "recovery" : undefined,
  };
}
