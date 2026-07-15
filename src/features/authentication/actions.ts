"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getAppUrl } from "@/lib/app-url";
import { safeNextPath } from "@/lib/auth/redirect";
import {
  classifyProfileWriteError,
  logActionFailure,
  newCorrelationId,
} from "@/lib/errors/action-errors";
import { createServerClient } from "@/lib/supabase/server";
import {
  errorState,
  successState,
  type ActionState,
} from "@/features/authentication/action-state";
import {
  onboardingPathSchema,
  changePasswordSchema,
  mfaCodeSchema,
  preferredModeSchema,
  profileSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/features/authentication/schemas";
import { hasVendorMembership } from "@/lib/auth/mode";
import { requireAuth, resolveVendorOnboardingPath } from "@/lib/auth/guards";

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
 * Set a new password. Requires the recovery session from the email link.
 */
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

  // End the recovery session — user must sign in with the new password.
  await supabase.auth.signOut();

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
    })
    .eq("id", ctx.user.id);

  if (error) {
    console.error("profile update failed", { code: error.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  return successState("Profile saved.");
}

/** Change password while signed in (requires current password). */
export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAuth();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
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
  const email = ctx.user.email;
  if (!email) {
    return errorState(GENERIC_AUTH_ERROR);
  }

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.currentPassword,
  });
  if (reauthError) {
    return errorState("Current password is incorrect.", {
      currentPassword: ["Current password is incorrect."],
    });
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
    console.error("password change failed", { code: error.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  return successState("Password updated.");
}

/**
 * First onboarding step: preferred UI mode only (not authorization).
 */
export async function chooseOnboardingPathAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAuth();

  const parsed = onboardingPathSchema.safeParse({
    preferredMode: formData.get("preferredMode"),
  });

  if (!parsed.success) {
    return errorState("Choose how you would like to get started.");
  }

  const supabase = await createServerClient();
  const correlationId = newCorrelationId();
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({
      preferred_mode: parsed.data.preferredMode,
      onboarding_status: "in_progress",
    })
    .eq("id", ctx.user.id)
    .select("id, preferred_mode")
    .maybeSingle();

  if (error) {
    const kind = classifyProfileWriteError(error);
    const { userMessage } = logActionFailure({
      correlationId,
      kind,
      operation: "chooseOnboardingPathAction",
      userId: ctx.user.id,
      code: error.code,
      message: error.message,
    });
    return errorState(userMessage);
  }

  if (!updated) {
    const { userMessage } = logActionFailure({
      correlationId,
      kind: "missing_profile",
      operation: "chooseOnboardingPathAction",
      userId: ctx.user.id,
      message: "profile row missing or update returned no rows",
    });
    return errorState(userMessage);
  }

  redirect(
    parsed.data.preferredMode === "vendor"
      ? "/onboarding/vendor/profile"
      : "/onboarding/customer",
  );
}

/** @deprecated Use chooseOnboardingPathAction */
export const chooseAccountTypeAction = chooseOnboardingPathAction;

/** Switch interface mode — preferred_mode only; vendor access still requires membership. */
export async function setPreferredModeAction(
  formData: FormData,
): Promise<void> {
  const ctx = await requireAuth();

  const parsed = preferredModeSchema.safeParse({
    preferredMode: formData.get("preferredMode"),
  });
  if (!parsed.success) {
    redirect("/account");
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ preferred_mode: parsed.data.preferredMode })
    .eq("id", ctx.user.id);

  if (error) {
    console.error("preferred mode update failed", { code: error.code });
    redirect("/account");
  }

  if (parsed.data.preferredMode === "customer") {
    redirect("/customer");
  }

  if (!hasVendorMembership(ctx)) {
    redirect(resolveVendorOnboardingPath(ctx));
  }

  redirect("/vendor");
}

/**
 * Step 2 of the vendor onboarding sequence: complete the personal profile
 * before organization creation. Does not mark onboarding complete — that
 * happens once the organization is created.
 */
export async function completeVendorProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAuth();

  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName"),
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
      preferred_mode: "vendor",
    })
    .eq("id", ctx.user.id);

  if (error) {
    console.error("vendor profile onboarding failed", { code: error.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  redirect("/onboarding/vendor");
}

/** Complete customer onboarding: save profile, mark complete. */
export async function completeCustomerOnboardingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAuth();

  if (
    ctx.profile?.preferred_mode !== "customer" &&
    ctx.profile?.onboarding_status !== "in_progress"
  ) {
    return errorState("Continue customer setup from onboarding.");
  }

  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName"),
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
      preferred_mode: "customer",
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
  /** otpauth:// enrollment URI — lets a supported authenticator app enroll
   * directly (account name/issuer included) without scanning or typing. */
  uri?: string;
};

/** Begin TOTP enrollment; returns the QR code + secret to display. */
export async function enrollMfaAction(): Promise<MfaEnrollmentState> {
  await requireAuth();
  const supabase = await createServerClient();

  const { data: factors, error: listError } =
    await supabase.auth.mfa.listFactors();
  if (listError) {
    console.error("MFA list factors failed", { code: listError.code });
    return errorState(GENERIC_AUTH_ERROR);
  }

  // Abandoned enrollments leave an unverified factor that blocks re-enroll.
  // listFactors() only includes verified factors in `totp`; scan `all`.
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type !== "totp" || factor.status !== "unverified") {
      continue;
    }
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({
      factorId: factor.id,
    });
    if (unenrollError) {
      console.error("MFA unenroll stale factor failed", {
        code: unenrollError.code,
      });
      return errorState(GENERIC_AUTH_ERROR);
    }
  }

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
    uri: data.totp.uri,
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
