"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuth, requireVendorMember } from "@/lib/auth/guards";
import { publicOrigin } from "@/lib/public-url";
import { createServerClient } from "@/lib/supabase/server";
import {
  errorState,
  successState,
  type ActionState,
} from "@/features/authentication/action-state";
import {
  generateInvitationSecret,
  hashInvitationToken,
  isValidInvitationToken,
} from "@/features/organizations/invitation-token";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

function friendlyDbError(error: { code?: string; message?: string }): string {
  if (error.code === "P0001" && error.message) {
    return error.message.replace(/^[^:]*:\s*/, "");
  }
  if (error.code === "42501") {
    return error.message?.replace(/^[^:]*:\s*/, "") ?? "You can't do that.";
  }
  return GENERIC_ERROR;
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(60),
  role: z.enum(["owner", "manager", "staff"]),
});

/**
 * Create an invitation and return the link for the owner to send themselves.
 *
 * The link is shown once, on screen. It is never emailed and never stored in
 * a readable form — the database holds only its digest — so the only copies
 * are the one the owner sends and the one the invitee receives.
 */
export async function createInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember(["owner", "manager"], "/vendor");

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    firstName: formData.get("firstName"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return errorState(
      "Enter a first name and a valid email address for the person you're inviting.",
    );
  }

  const { token, tokenDigest } = generateInvitationSecret();
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("organization_create_invitation", {
    p_organization_id: ctx.membership.organization_id,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
    p_first_name: parsed.data.firstName,
    p_token_digest: tokenDigest,
  });
  if (error) {
    return errorState(friendlyDbError(error));
  }

  const { origin } = await publicOrigin();
  revalidatePath("/vendor");
  // The link rides back in the success message so the page can surface it for
  // copying. It is not persisted anywhere retrievable.
  return successState(
    `${parsed.data.firstName}'s invite link|${origin}/invite/${token}`,
  );
}

export async function revokeInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireVendorMember(["owner", "manager"], "/vendor");
  const id = formData.get("invitationId")?.toString() ?? "";
  if (!id) return errorState(GENERIC_ERROR);

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("organization_revoke_invitation", {
    p_invitation_id: id,
  });
  if (error) return errorState(friendlyDbError(error));

  revalidatePath("/vendor");
  return successState("Invitation cancelled. That link no longer works.");
}

export type InvitationPreview = {
  outcome:
    | "not_found"
    | "already_accepted"
    | "revoked"
    | "expired"
    | "sign_in_required"
    | "wrong_account"
    | "ready";
  organizationName: string | null;
  role: "owner" | "manager" | "staff" | null;
  firstName: string | null;
  invitedEmail: string | null;
};

/**
 * What the invite page shows before anyone commits. Readable signed out, so a
 * new hire can be told to sign up first — but it reveals only the business
 * name and the role, never who else is on the team.
 */
export async function previewInvitationAction(
  token: string,
): Promise<InvitationPreview> {
  const empty: InvitationPreview = {
    outcome: "not_found",
    organizationName: null,
    role: null,
    firstName: null,
    invitedEmail: null,
  };
  if (!isValidInvitationToken(token)) return empty;

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc(
    "organization_invitation_preview",
    {
      p_token_digest: hashInvitationToken(token),
    },
  );
  if (error || !data?.[0]) return empty;

  const row = data[0];
  return {
    outcome: row.outcome as InvitationPreview["outcome"],
    organizationName: row.organization_name,
    role: row.role,
    firstName: row.first_name,
    invitedEmail: row.invited_email,
  };
}

export async function acceptInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = formData.get("token")?.toString() ?? "";
  await requireAuth(`/invite/${token}`);

  if (!isValidInvitationToken(token)) {
    return errorState("This invitation link is not valid.");
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("organization_accept_invitation", {
    p_token_digest: hashInvitationToken(token),
  });
  if (error) return errorState(friendlyDbError(error));
  if (!data?.[0]) return errorState(GENERIC_ERROR);

  revalidatePath("/vendor");
  return successState("You're on the team.");
}
