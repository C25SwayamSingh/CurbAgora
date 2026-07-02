"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getAppUrl } from "@/lib/app-url";
import { requireAuth } from "@/lib/auth/guards";
import { safeNextPath } from "@/lib/auth/redirect";
import { createServerClient } from "@/lib/supabase/server";
import {
  errorState,
  successState,
  type ActionState,
} from "@/features/authentication/action-state";
import {
  accountTypeSchema,
  forgotPasswordSchema,
  mfaCodeSchema,
  profileSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/features/authentication/schemas";

const GENERIC_AUTH_ERROR =
  "Something went wrong. Please try again in a moment.";

/**
 * Create account with email + password. Email verification is required
 * before sign-in (configured in Supabase); we redirect to /verify-email.
 */
export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${getAppUrl()}/auth/confirm?next=/onboarding`,
      data: { display_name: parsed.data.displayName },
    },
  });

  if (error) {
    // Do not reveal whether the email is already registered.
    if (error.code === "weak_password") {
      return errorState("Please choose a stronger password.", {
        password: [error.message],
      });
    }
    console.error("sign-up failed", { code: error.code });
    if (error.code === "user_already_exists" || error.status === 422) {
      redirect(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
    }
    return errorState(GENERIC_AUTH_ERROR);
  }

  redirect(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
}

/** Sign in with email + password; routes to MFA challenge when required. */
export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const nextPath = safeNextPath(
    formData.get("next")?.toString(),
    "/onboarding",
  );

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    if (error.code === "email_not_confirmed") {
      return errorState(
        "Please verify your email first — check your inbox for the confirmation link.",
      );
    }
    return errorState("Incorrect email or password.");
  }

  // If the user has a verified MFA factor, the password alone only grants
  // aal1 — require the TOTP challenge before reaching protected pages.
  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(`/mfa-challenge?next=${encodeURIComponent(nextPath)}`);
  }

  redirect(nextPath);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

/** Sign out every other session for this user (device revocation). */
export async function signOutOtherSessionsAction(): Promise<ActionState> {
  await requireAuth();
  const supabase = await createServerClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    console.error("sign-out-others failed", { code: error.code });
    return errorState(GENERIC_AUTH_ERROR);
  }
  return successState("All other sessions have been signed out.");
}

/**
 * Request a password reset email. Always reports success so the form cannot
 * be used to probe which emails are registered.
 */
export async function forgotPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    { redirectTo: `${getAppUrl()}/auth/confirm?next=/reset-password` },
  );

  if (error) {
    console.error("password-reset request failed", { code: error.code });
  }

  return successState(
    "If an account exists for that email, a reset link is on its way.",
  );
}

/** Set a new password. Requires the recovery session from the email link. */
export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorState("Your reset link has expired. Please request a new one.");
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    if (error.code === "same_password") {
      return errorState("Choose a password you have not used before.", {
        password: ["New password must be different from the current one."],
      });
    }
    console.error("password update failed", { code: error.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  redirect("/sign-in?reset=success");
}

/** Update the caller's own profile — approved fields only. */
export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAuth();

  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName"),
    avatarUrl: formData.get("avatarUrl") ?? "",
  });

  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = await createServerClient();
  // Only whitelisted columns are written; authorization fields
  // (account_type, id) are additionally protected by a DB trigger.
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      avatar_url: parsed.data.avatarUrl || null,
    })
    .eq("id", ctx.user.id);

  if (error) {
    console.error("profile update failed", { code: error.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  return successState("Profile saved.");
}

/**
 * One-time onboarding choice between customer and vendor. The DB trigger
 * rejects any later change, so a customer can never flip themselves to
 * vendor after the fact.
 */
export async function chooseAccountTypeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAuth();

  const parsed = accountTypeSchema.safeParse({
    accountType: formData.get("accountType"),
  });

  if (!parsed.success) {
    return errorState("Choose customer or vendor to continue.");
  }

  if (
    ctx.profile?.account_type &&
    ctx.profile.account_type !== parsed.data.accountType
  ) {
    return errorState(
      "Your account type is already set and cannot be changed here.",
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      account_type: parsed.data.accountType,
      onboarding_status: "in_progress",
    })
    .eq("id", ctx.user.id);

  if (error) {
    console.error("account type selection failed", { code: error.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  redirect(
    parsed.data.accountType === "vendor"
      ? "/onboarding/vendor/profile"
      : "/onboarding/customer",
  );
}

/**
 * Step 2 of the vendor onboarding sequence: complete the personal profile
 * before MFA enrollment and organization creation. Does not mark onboarding
 * complete — that happens once the organization is created.
 */
export async function completeVendorProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAuth();

  if (ctx.profile?.account_type !== "vendor") {
    return errorState("Vendor onboarding requires a vendor account.");
  }

  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName"),
    avatarUrl: formData.get("avatarUrl") ?? "",
  });

  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      avatar_url: parsed.data.avatarUrl || null,
    })
    .eq("id", ctx.user.id);

  if (error) {
    console.error("vendor profile onboarding failed", { code: error.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  redirect("/onboarding/vendor/mfa");
}

/** Complete customer onboarding: save profile, mark complete. */
export async function completeCustomerOnboardingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAuth();

  if (ctx.profile?.account_type !== "customer") {
    return errorState("Customer onboarding requires a customer account.");
  }

  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName"),
    avatarUrl: formData.get("avatarUrl") ?? "",
  });

  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      avatar_url: parsed.data.avatarUrl || null,
      onboarding_status: "complete",
    })
    .eq("id", ctx.user.id);

  if (error) {
    console.error("customer onboarding failed", { code: error.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  redirect("/customer");
}

// ---------------------------------------------------------------------------
// MFA (Supabase TOTP). No custom crypto — everything delegates to Supabase.
// Assurance level is always re-checked server-side (guards + RLS policies);
// client state alone never marks a session as MFA-verified.
// ---------------------------------------------------------------------------

export type MfaEnrollmentState = ActionState & {
  factorId?: string;
  qrCode?: string;
  secret?: string;
};

/** Begin TOTP enrollment; returns the QR code + secret to display. */
export async function enrollMfaAction(): Promise<MfaEnrollmentState> {
  await requireAuth();
  const supabase = await createServerClient();

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
  });

  if (error || !data) {
    console.error("MFA enroll failed", { code: error?.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  return {
    status: "success",
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/** Verify the first TOTP code to activate a pending enrollment. */
export async function verifyMfaEnrollmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAuth();

  const parsed = mfaCodeSchema.safeParse({ code: formData.get("code") });
  const factorId = formData.get("factorId")?.toString();

  if (!parsed.success || !factorId) {
    return errorState(
      "Enter the 6-digit code from your authenticator app.",
      parsed.success ? undefined : z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = await createServerClient();

  const { data: challenge, error: challengeError } =
    await supabase.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) {
    console.error("MFA challenge failed", { code: challengeError?.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: parsed.data.code,
  });

  if (verifyError) {
    return errorState("That code didn't match. Please try again.", {
      code: ["Invalid or expired code."],
    });
  }

  const rawNext = formData.get("next")?.toString();
  redirect(rawNext ? safeNextPath(rawNext) : "/account/security?mfa=enrolled");
}

/** Verify a TOTP code at sign-in to upgrade the session to aal2. */
export async function mfaChallengeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAuth();

  const parsed = mfaCodeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) {
    return errorState(
      "Enter the 6-digit code from your authenticator app.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const nextPath = safeNextPath(
    formData.get("next")?.toString(),
    "/onboarding",
  );

  const supabase = await createServerClient();
  const { data: factors, error: factorsError } =
    await supabase.auth.mfa.listFactors();
  const totpFactor = factors?.totp.find((f) => f.status === "verified");

  if (factorsError || !totpFactor) {
    return errorState("No verified authenticator app was found.");
  }

  const { data: challenge, error: challengeError } =
    await supabase.auth.mfa.challenge({ factorId: totpFactor.id });
  if (challengeError || !challenge) {
    console.error("MFA challenge failed", { code: challengeError?.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: totpFactor.id,
    challengeId: challenge.id,
    code: parsed.data.code,
  });

  if (verifyError) {
    return errorState("That code didn't match. Please try again.", {
      code: ["Invalid or expired code."],
    });
  }

  redirect(nextPath);
}

/**
 * Remove a TOTP factor. Requires an aal2 session — a session that has not
 * proven MFA cannot remove MFA.
 */
export async function unenrollMfaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAuth();

  if (ctx.aal !== "aal2") {
    return errorState("Verify with your authenticator app before removing it.");
  }

  const factorId = formData.get("factorId")?.toString();
  if (!factorId) {
    return errorState(GENERIC_AUTH_ERROR);
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });

  if (error) {
    console.error("MFA unenroll failed", { code: error.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  return successState("Authenticator app removed.");
}
