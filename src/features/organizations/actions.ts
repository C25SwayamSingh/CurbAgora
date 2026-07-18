"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuth, requireVendorSensitiveAction } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import {
  errorState,
  successState,
  type ActionState,
} from "@/features/authentication/action-state";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from "@/features/organizations/schemas";

/**
 * Vendor onboarding: create the organization and its initial owner
 * membership. Delegates to the create_organization_with_owner database
 * function, which runs both inserts in one transaction (no ownerless org)
 * — the client supplies only the org names/slug, never roles or IDs.
 *
 * Creating an organization requires only an authenticated, confirmed-email
 * session — MFA is not a precondition. Sensitive management actions
 * afterward (updating org settings, inviting/removing members, changing
 * roles) remain mandatory-MFA via `requireVendorSensitiveAction` and the
 * database's restrictive `mfa_assurance_ok()` policies.
 */
export async function createOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAuth();

  // Idempotency: if this user already owns an org (e.g. duplicate submit or
  // browser retry), don't create a second one — continue onboarding.
  if (ctx.memberships.some((m) => m.role === "owner")) {
    redirect("/vendor");
  }

  const parsed = createOrganizationSchema.safeParse({
    legalName: formData.get("legalName"),
    displayName: formData.get("displayName"),
    slug: formData.get("slug"),
  });

  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("create_organization_with_owner", {
    p_legal_name: parsed.data.legalName,
    p_display_name: parsed.data.displayName,
    p_slug: parsed.data.slug,
  });

  if (error) {
    if (error.code === "23505") {
      return errorState("That URL name is already taken.", {
        slug: ["Choose a different URL name."],
      });
    }
    console.error("organization creation failed", { code: error.code });
    return errorState("Something went wrong. Please try again in a moment.");
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      onboarding_status: "complete",
      preferred_mode: "vendor",
    })
    .eq("id", ctx.user.id);

  if (profileError) {
    console.error("onboarding status update failed", {
      code: profileError.code,
    });
  }

  redirect("/vendor");
}

/**
 * Update the caller's organization's business details (display name, legal
 * name, URL slug). Owner-only and mandatory-MFA (requireVendorSensitiveAction)
 * — matches the database's own organizations_update_owner /
 * organizations_update_requires_mfa restrictive policies, which this action
 * relies on as the actual enforcement, not just the app-layer role check.
 */
export async function updateOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorSensitiveAction(
    ["owner"],
    "/vendor/organization/edit",
  );

  const parsed = updateOrganizationSchema.safeParse({
    legalName: formData.get("legalName"),
    displayName: formData.get("displayName"),
    slug: formData.get("slug"),
  });

  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      legal_name: parsed.data.legalName,
      display_name: parsed.data.displayName,
      slug: parsed.data.slug,
    })
    .eq("id", ctx.membership.organization_id);

  if (error) {
    if (error.code === "23505") {
      return errorState("That URL name is already taken.", {
        slug: ["Choose a different URL name."],
      });
    }
    console.error("organization update failed", { code: error.code });
    return errorState("Something went wrong. Please try again in a moment.");
  }

  revalidatePath("/vendor");
  return successState("Business details updated.");
}
