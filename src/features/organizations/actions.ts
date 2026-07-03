"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { enforceMfaVerified, requireAuth } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import {
  errorState,
  type ActionState,
} from "@/features/authentication/action-state";
import { createOrganizationSchema } from "@/features/organizations/schemas";

const ORG_CREATION_PATH = "/onboarding/vendor";

/**
 * Vendor onboarding: create the organization and its initial owner
 * membership. Delegates to the create_organization_with_owner database
 * function, which runs both inserts in one transaction (no ownerless org)
 * and re-validates the caller's vendor status server-side — the client
 * supplies only the org names/slug, never roles or IDs.
 *
 * Creating an organization is a sensitive operation with mandatory MFA:
 * this action independently re-verifies an aal2 session immediately before
 * calling the database (never trusting the page-level redirect alone), and
 * the database function independently rejects the call again if the JWT is
 * not aal2 — three enforcement layers total.
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

  // Independent server-side AAL2 re-verification (mandatory for owners).
  enforceMfaVerified(ctx, ORG_CREATION_PATH);

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
