import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { confirmEmailToken } from "@/lib/auth/confirm-token";
import { createServerClient } from "@/lib/supabase/server";

function parseOtpType(value: string | null): EmailOtpType | null {
  if (!value) {
    return null;
  }
  return value as EmailOtpType;
}

async function handleConfirm(
  request: NextRequest,
  input: {
    tokenHash: string | null;
    type: EmailOtpType | null;
    next?: string | null;
  },
) {
  const supabase = await createServerClient();
  const result = await confirmEmailToken(supabase, input);

  const redirectTo = request.nextUrl.clone();
  redirectTo.search = "";
  redirectTo.pathname = result.pathname;
  if (result.flow) {
    redirectTo.searchParams.set("flow", result.flow);
  }

  return NextResponse.redirect(redirectTo, 303);
}

/**
 * Verifies email-link tokens (sign-up confirmation, password recovery,
 * email change). Recovery tokens from the interstitial page are submitted via
 * POST so automated GET prefetchers cannot consume them.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  return handleConfirm(request, {
    tokenHash: searchParams.get("token_hash"),
    type: parseOtpType(searchParams.get("type")),
    next: searchParams.get("next"),
  });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  return handleConfirm(request, {
    tokenHash: formData.get("token_hash")?.toString() ?? null,
    type: parseOtpType(formData.get("type")?.toString() ?? null),
    next: formData.get("next")?.toString() ?? null,
  });
}
