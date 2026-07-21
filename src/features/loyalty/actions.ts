"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuth, requireVendorMember } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import {
  errorState,
  successState,
  type ActionState,
} from "@/features/authentication/action-state";
import { validateStampProgram } from "@/features/loyalty/engine";
import {
  askLoyaltyConsultant,
  type ConsultantContext,
} from "@/features/loyalty/consultant";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

/**
 * Postgres raise messages in the loyalty functions are authored,
 * customer-safe sentences (P0001). Pass those through; anything else
 * gets the generic message so internals never leak.
 */
function friendlyDbError(error: { code?: string; message?: string }): string {
  if (error.code === "P0001" && error.message) {
    return error.message.replace(/^[^:]*:\s*/, "");
  }
  if (error.code === "42501") {
    return "You don't have permission to do that.";
  }
  if (error.code === "23505") {
    return "There's already an open code for this — use the newest one.";
  }
  return GENERIC_ERROR;
}

const publishSchema = z.object({
  organizationId: z.string().min(1),
  stampsRequired: z.coerce.number().int(),
  qualifyingMinCents: z.coerce.number().int(),
  stampPeriodMinutes: z.coerce.number().int(),
  rewardName: z.string().trim().min(1).max(120),
  rewardRetailValueCents: z.coerce.number().int(),
  rewardEstCostCents: z
    .string()
    .transform((v) => (v.trim() === "" ? null : Number(v)))
    .pipe(z.number().int().min(0).nullable()),
  advisorSnapshot: z.string().optional(),
});

/** Owner/manager publishes (or replaces) the org's stamp program. */
export async function publishLoyaltyProgramAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember(
    ["owner", "manager"],
    "/vendor/loyalty",
  );

  const parsed = publishSchema.safeParse({
    organizationId: formData.get("organizationId"),
    stampsRequired: formData.get("stampsRequired"),
    qualifyingMinCents: formData.get("qualifyingMinCents"),
    stampPeriodMinutes: formData.get("stampPeriodMinutes"),
    rewardName: formData.get("rewardName"),
    rewardRetailValueCents: formData.get("rewardRetailValueCents"),
    rewardEstCostCents: formData.get("rewardEstCostCents") ?? "",
    advisorSnapshot: formData.get("advisorSnapshot")?.toString(),
  });
  if (!parsed.success) {
    return errorState("Please fix the highlighted fields.");
  }
  // The org is always the caller's own membership — never client input.
  if (parsed.data.organizationId !== ctx.membership.organization_id) {
    return errorState(GENERIC_ERROR);
  }

  const validation = validateStampProgram({
    stampsRequired: parsed.data.stampsRequired,
    qualifyingMinCents: parsed.data.qualifyingMinCents,
    stampPeriodMinutes: parsed.data.stampPeriodMinutes,
    rewardName: parsed.data.rewardName,
    rewardRetailValueCents: parsed.data.rewardRetailValueCents,
    rewardEstCostCents: parsed.data.rewardEstCostCents,
  });
  if (validation.errors.length > 0) {
    return errorState(validation.errors.join(" "));
  }

  let snapshot: unknown = null;
  if (parsed.data.advisorSnapshot) {
    try {
      snapshot = JSON.parse(parsed.data.advisorSnapshot);
    } catch {
      snapshot = null;
    }
  }

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("loyalty_publish_program", {
    p_organization_id: ctx.membership.organization_id,
    p_stamps_required: parsed.data.stampsRequired,
    p_qualifying_min_cents: parsed.data.qualifyingMinCents,
    p_stamp_period_minutes: parsed.data.stampPeriodMinutes,
    p_reward_name: parsed.data.rewardName,
    p_reward_retail_value_cents: parsed.data.rewardRetailValueCents,
    p_reward_est_cost_cents: parsed.data.rewardEstCostCents,
    p_advisor_snapshot: snapshot as never,
  });
  if (error) {
    console.error("loyalty publish failed", { code: error.code });
    return errorState(friendlyDbError(error));
  }

  revalidatePath("/vendor/loyalty");
  revalidatePath("/vendor");
  return successState("Your loyalty program is live.");
}

export async function setLoyaltyPausedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember(
    ["owner", "manager"],
    "/vendor/loyalty",
  );
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("loyalty_set_program_paused", {
    p_organization_id: ctx.membership.organization_id,
    p_earning_paused: formData.get("earningPaused") === "true",
    p_redemption_paused: formData.get("redemptionPaused") === "true",
  });
  if (error) {
    console.error("loyalty pause failed", { code: error.code });
    return errorState(friendlyDbError(error));
  }
  revalidatePath("/vendor/loyalty");
  return successState("Program status updated.");
}

/** Staff confirms a customer's stamp code at the counter (any role). */
export async function confirmLoyaltyClaimAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember(undefined, "/vendor/loyalty");
  const code = formData.get("code")?.toString().trim() ?? "";
  if (!/^[A-Za-z2-9]{6}$/.test(code)) {
    return errorState("Enter the 6-character code from the customer's phone.");
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("loyalty_confirm_claim", {
    p_organization_id: ctx.membership.organization_id,
    p_code: code,
  });
  if (error) {
    return errorState(friendlyDbError(error));
  }
  const result = data?.[0];
  if (!result) {
    return errorState(GENERIC_ERROR);
  }
  revalidatePath("/vendor/loyalty");
  return successState(
    result.first_visit
      ? `First visit! Stamp added (plus welcome bonus) — customer now has ${result.stamp_balance} of ${result.stamps_required}.`
      : `Stamp added — customer now has ${result.stamp_balance} of ${result.stamps_required}.`,
  );
}

/** Staff confirms a redemption code and hands over the reward. */
export async function confirmLoyaltyRedemptionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember(undefined, "/vendor/loyalty");
  const code = formData.get("code")?.toString().trim() ?? "";
  if (!/^[A-Za-z2-9]{6}$/.test(code)) {
    return errorState("Enter the 6-character redemption code.");
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("loyalty_confirm_redemption", {
    p_organization_id: ctx.membership.organization_id,
    p_code: code,
  });
  if (error) {
    return errorState(friendlyDbError(error));
  }
  const result = data?.[0];
  if (!result) {
    return errorState(GENERIC_ERROR);
  }
  revalidatePath("/vendor/loyalty");
  return successState(
    `Redeemed: give the customer their ${result.reward_name}. Remaining balance: ${result.remaining_balance} stamps.`,
  );
}

export type LoyaltyCodeResult =
  | { ok: true; code: string; expiresAt: string; rewardName?: string }
  | { ok: false; message: string };

/** Customer asks for a stamp code to show at the counter. */
export async function createLoyaltyClaimCode(
  organizationId: string,
): Promise<LoyaltyCodeResult> {
  await requireAuth("/rewards");
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("loyalty_create_claim_code", {
    p_organization_id: organizationId,
  });
  if (error || !data?.[0]) {
    return {
      ok: false,
      message: error ? friendlyDbError(error) : GENERIC_ERROR,
    };
  }
  return { ok: true, code: data[0].code, expiresAt: data[0].expires_at };
}

/** Customer starts a redemption once the card is full. */
export async function requestLoyaltyRedemption(
  organizationId: string,
): Promise<LoyaltyCodeResult> {
  await requireAuth("/rewards");
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("loyalty_request_redemption", {
    p_organization_id: organizationId,
  });
  if (error || !data?.[0]) {
    return {
      ok: false,
      message: error ? friendlyDbError(error) : GENERIC_ERROR,
    };
  }
  return {
    ok: true,
    code: data[0].code,
    expiresAt: data[0].expires_at,
    rewardName: data[0].reward_name,
  };
}

export type ConsultantResult =
  { ok: true; text: string } | { ok: false; message: string };

/**
 * Optional free-form Q&A with the (LLM-backed) Loyalty Advisor. The model is
 * grounded strictly in this org's own active program + deterministic stats and
 * has no authority over any balance — see consultant.ts. Only owners/managers
 * can consult it, and it is unavailable when ANTHROPIC_API_KEY is unset.
 */
export async function askLoyaltyAdvisorAction(
  question: string,
): Promise<ConsultantResult> {
  const ctx = await requireVendorMember(
    ["owner", "manager"],
    "/vendor/loyalty",
  );
  const supabase = await createServerClient();

  const [{ data: version }, { data: statsRows }] = await Promise.all([
    supabase
      .from("loyalty_program_versions")
      .select("*")
      .eq("organization_id", ctx.membership.organization_id)
      .eq("status", "active")
      .maybeSingle(),
    supabase.rpc("loyalty_program_stats", {
      p_organization_id: ctx.membership.organization_id,
    }),
  ]);

  const stats = statsRows?.[0];
  const context: ConsultantContext = {
    recommendations: [],
    activeProgram: version
      ? {
          stampsRequired: version.stamps_required,
          rewardName: version.reward_name,
        }
      : null,
    stats: stats
      ? {
          members: stats.members,
          stampsIssued: Number(stats.stamps_issued),
          rewardsRedeemed: Number(stats.rewards_redeemed),
          outstandingStamps: Number(stats.outstanding_stamps),
          estimatedLiabilityCents: Number(stats.estimated_liability_cents),
        }
      : null,
  };

  const reply = await askLoyaltyConsultant(question, context);
  if (reply.ok) {
    return { ok: true, text: reply.text };
  }
  return {
    ok: false,
    message:
      reply.reason === "unconfigured"
        ? "The conversational advisor isn't enabled on this deployment."
        : "Couldn't reach the advisor just now. Please try again.",
  };
}
