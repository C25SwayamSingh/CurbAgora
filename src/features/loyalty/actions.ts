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
import {
  blockingIssues,
  formatCents,
  formatPoints,
  validatePointsProgram,
  type CatalogItemConfig,
} from "@/features/loyalty/engine";
import {
  askLoyaltyConsultant,
  type ConsultantContext,
} from "@/features/loyalty/consultant";
import {
  formatCheckoutPayload,
  isValidNumericCode,
  parseSubtotalToCents,
} from "@/features/loyalty/checkout-code";
import {
  generateCheckoutSecrets,
  hashCheckoutToken,
} from "@/features/loyalty/checkout-token";

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

/* ------------------------------------------------------------------ */
/* Publish                                                             */
/* ------------------------------------------------------------------ */

const catalogItemSchema = z.object({
  pointsCost: z.number().int().positive(),
  rewardKind: z.enum(["FREE_ITEM", "FIXED_DISCOUNT"]),
  rewardName: z.string().trim().min(1).max(120),
  rewardValueCents: z.number().int().positive(),
  rewardEstCostCents: z.number().int().min(0).nullable(),
});

const publishSchema = z.object({
  organizationId: z.string().min(1),
  pointsPerDollar: z.coerce.number().int().min(1).max(100),
  catalog: z.string().min(2),
  advisorSnapshot: z.string().optional(),
  /**
   * Fingerprint of the answers the displayed recommendation was computed
   * from. The client refuses to submit a stale card; this is the server-side
   * backstop so a stale form post can't publish either.
   */
  inputsFingerprint: z.string().min(1),
  currentFingerprint: z.string().min(1),
});

/** Owner/manager publishes (or replaces) the org's points program. */
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
    pointsPerDollar: formData.get("pointsPerDollar"),
    catalog: formData.get("catalog"),
    advisorSnapshot: formData.get("advisorSnapshot")?.toString(),
    inputsFingerprint: formData.get("inputsFingerprint"),
    currentFingerprint: formData.get("currentFingerprint"),
  });
  if (!parsed.success) {
    return errorState("Please fix the highlighted fields.");
  }
  // The org is always the caller's own membership — never client input.
  if (parsed.data.organizationId !== ctx.membership.organization_id) {
    return errorState(GENERIC_ERROR);
  }
  if (parsed.data.inputsFingerprint !== parsed.data.currentFingerprint) {
    return errorState(
      "Your answers changed after this recommendation was calculated. Select “Get recommendations” again, then publish the refreshed option.",
    );
  }

  let rawCatalog: unknown;
  try {
    rawCatalog = JSON.parse(parsed.data.catalog);
  } catch {
    return errorState(GENERIC_ERROR);
  }
  const catalogParsed = z
    .array(catalogItemSchema)
    .min(1)
    .max(6)
    .safeParse(rawCatalog);
  if (!catalogParsed.success) {
    return errorState(
      "That reward catalog isn't valid. Recalculate and retry.",
    );
  }

  const catalog: CatalogItemConfig[] = catalogParsed.data.map((item) => ({
    pointsCost: item.pointsCost,
    reward:
      item.rewardKind === "FREE_ITEM"
        ? {
            kind: "FREE_ITEM",
            name: item.rewardName,
            retailCents: item.rewardValueCents,
            unitCostCents: item.rewardEstCostCents,
          }
        : {
            kind: "FIXED_DISCOUNT",
            name: item.rewardName,
            discountCents: item.rewardValueCents,
          },
  }));

  const validation = validatePointsProgram({
    pointsPerDollar: parsed.data.pointsPerDollar,
    catalog,
  });
  if (validation.blocked) {
    return errorState(
      blockingIssues(validation)
        .map((i) => i.message)
        .join(" "),
    );
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
    p_points_per_dollar: parsed.data.pointsPerDollar,
    p_catalog: catalogParsed.data.map((i) => ({
      points_cost: i.pointsCost,
      reward_kind: i.rewardKind,
      reward_name: i.rewardName,
      reward_value_cents: i.rewardValueCents,
      reward_est_cost_cents: i.rewardEstCostCents,
    })) as never,
    p_advisor_snapshot: snapshot as never,
  });
  if (error) {
    console.error("loyalty publish failed", { code: error.code });
    return errorState(friendlyDbError(error));
  }

  revalidatePath("/vendor/loyalty");
  revalidatePath("/vendor");
  return successState("Your points program is live.");
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

/* ------------------------------------------------------------------ */
/* Checkout identification — staff side                                */
/* ------------------------------------------------------------------ */

const CODE_PATTERN = /^[A-Za-z2-9]{6}$/;

export type IdentifiedMember = {
  sessionId: string;
  displayName: string | null;
  memberRef: string;
  pointBalance: number;
  expiresAt: string;
};

export type ResolveResult =
  { ok: true; member: IdentifiedMember } | { ok: false; message: string };

/** Counter-ready wording for each way an identification can come back empty. */
const RESOLVE_FAILURE_MESSAGE: Record<string, string> = {
  not_found: "That code wasn't recognized — ask for a fresh one.",
  expired: "That code has expired — ask the customer to refresh it.",
  consumed: "That code was already used — ask the customer for a fresh one.",
  throttled:
    "Too many incorrect codes. Wait a few minutes, or scan the customer's QR instead.",
};

/**
 * Staff identifies the customer in front of them, by scanned QR token or by
 * the 4-digit code the customer reads aloud. Both resolve the same session.
 *
 * This step deliberately awards nothing — it only answers "who is this?" so
 * the next screen can ask for the register amount.
 */
export async function resolveCheckoutSessionAction(
  method: "qr" | "code4",
  value: string,
): Promise<ResolveResult> {
  const ctx = await requireVendorMember(undefined, "/vendor/checkout");

  const trimmed = value.trim();
  if (method === "code4" && !isValidNumericCode(trimmed)) {
    return { ok: false, message: "Enter the customer's 4-digit code." };
  }
  if (method === "qr" && !/^[A-Za-z0-9_-]{43}$/.test(trimmed)) {
    return { ok: false, message: "That QR isn't a CurbAgora checkout code." };
  }

  // The QR carries the raw token; the database only ever holds its digest.
  const lookupValue = method === "qr" ? hashCheckoutToken(trimmed) : trimmed;

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc(
    "loyalty_resolve_checkout_session",
    {
      p_organization_id: ctx.membership.organization_id,
      p_method: method,
      p_value: lookupValue,
    },
  );
  if (error) {
    return { ok: false, message: friendlyDbError(error) };
  }
  const row = data?.[0];
  if (!row) {
    return { ok: false, message: GENERIC_ERROR };
  }

  // A miss is a value, not an exception — see the migration's note on why
  // raising would roll back the audit row the rate limiter depends on.
  if (row.outcome !== "resolved") {
    return { ok: false, message: RESOLVE_FAILURE_MESSAGE[row.outcome] };
  }

  return {
    ok: true,
    member: {
      sessionId: row.session_id!,
      displayName: row.display_name,
      memberRef: row.member_ref!,
      pointBalance: row.point_balance!,
      expiresAt: row.expires_at!,
    },
  };
}

export type AwardResult =
  | {
      ok: true;
      pointsAwarded: number;
      pointBalance: number;
      message: string;
    }
  | { ok: false; message: string };

/**
 * Staff enters the verified eligible subtotal from the register and confirms.
 * This is the only earning path: the customer never supplies the amount, and
 * the server — not the client — turns it into points.
 */
export async function awardPointsAction(
  sessionId: string,
  subtotal: string,
): Promise<AwardResult> {
  const ctx = await requireVendorMember(undefined, "/vendor/checkout");

  const subtotalCents = parseSubtotalToCents(subtotal);
  if (subtotalCents === null) {
    return {
      ok: false,
      message: "Enter the eligible subtotal from the register, like 12.50.",
    };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("loyalty_award_points", {
    p_organization_id: ctx.membership.organization_id,
    p_session_id: sessionId,
    p_eligible_subtotal_cents: subtotalCents,
  });
  if (error) {
    return { ok: false, message: friendlyDbError(error) };
  }
  const result = data?.[0];
  if (!result) {
    return { ok: false, message: GENERIC_ERROR };
  }
  revalidatePath("/vendor/loyalty");
  return {
    ok: true,
    pointsAwarded: result.points_awarded,
    pointBalance: result.point_balance,
    message: `${formatCents(subtotalCents)} — ${formatPoints(result.points_awarded)} awarded. Balance: ${formatPoints(result.point_balance)}.`,
  };
}

/** Staff confirms a redemption code and hands over the reward. */
export async function confirmLoyaltyRedemptionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember(undefined, "/vendor/loyalty");
  const code = formData.get("code")?.toString().trim() ?? "";
  if (!CODE_PATTERN.test(code)) {
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
    `Redeemed: give the customer their ${result.reward_name}. Remaining balance: ${formatPoints(result.remaining_balance)}.`,
  );
}

/* ------------------------------------------------------------------ */
/* Customer                                                            */
/* ------------------------------------------------------------------ */

export type LoyaltyCodeResult =
  | { ok: true; code: string; expiresAt: string; rewardName?: string }
  | { ok: false; message: string };

export type CheckoutSession = {
  sessionId: string;
  /** The opaque QR payload. Never persisted anywhere. */
  qrPayload: string;
  /** Spoken fallback for the same session. */
  numericCode: string;
  expiresAt: string;
};

export type CheckoutSessionResult =
  { ok: true; session: CheckoutSession } | { ok: false; message: string };

/**
 * Customer opens a short-lived checkout identity to show at the counter.
 *
 * The token is minted here and hashed before it touches the database, so the
 * only place a scannable code exists is the customer's own screen. Opening a
 * new session retires the previous one, which is what makes a screenshot of an
 * older QR useless.
 */
export async function startCheckoutSessionAction(
  organizationId: string,
  vendorUnitId?: string | null,
): Promise<CheckoutSessionResult> {
  await requireAuth("/rewards");
  const { token, tokenDigest, codeCandidates } = generateCheckoutSecrets();

  const supabase = await createServerClient();
  // Pass the unit explicitly, including as null. supabase-js drops `undefined`
  // keys, and PostgREST resolves a function by its full set of named arguments
  // — so an omitted key means "no such function", not "use the default".
  const { data, error } = await supabase.rpc("loyalty_start_checkout_session", {
    p_organization_id: organizationId,
    p_token_digest: tokenDigest,
    p_code_candidates: codeCandidates,
    p_vendor_unit_id: vendorUnitId ?? null,
  });
  if (error || !data?.[0]) {
    return {
      ok: false,
      message: error ? friendlyDbError(error) : GENERIC_ERROR,
    };
  }
  return {
    ok: true,
    session: {
      sessionId: data[0].session_id,
      qrPayload: formatCheckoutPayload(token),
      numericCode: data[0].numeric_code,
      expiresAt: data[0].expires_at,
    },
  };
}

/** Customer discards the current code; the next call mints a fresh one. */
export async function cancelCheckoutSessionAction(
  sessionId: string,
): Promise<void> {
  await requireAuth("/rewards");
  const supabase = await createServerClient();
  await supabase.rpc("loyalty_cancel_checkout_session", {
    p_session_id: sessionId,
  });
}

export type CheckoutStatus = {
  status: "pending" | "confirmed" | "cancelled" | "expired" | "locked";
  pointsAwarded: number;
  pointBalance: number;
  expiresAt: string;
};

/**
 * Polled by the customer's own screen so the "points earned" moment appears
 * without them refreshing. Scoped to the caller's own session by the database
 * function — a customer cannot watch anyone else's checkout.
 */
export async function getCheckoutStatusAction(
  sessionId: string,
): Promise<CheckoutStatus | null> {
  await requireAuth("/rewards");
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc(
    "loyalty_checkout_session_status",
    { p_session_id: sessionId },
  );
  if (error || !data?.[0]) return null;
  return {
    status: data[0].status as CheckoutStatus["status"],
    pointsAwarded: data[0].points_awarded,
    pointBalance: data[0].point_balance,
    expiresAt: data[0].expires_at,
  };
}

/** Customer redeems a specific catalog reward once they have the points. */
export async function requestLoyaltyRedemption(
  organizationId: string,
  catalogItemId: string,
): Promise<LoyaltyCodeResult> {
  await requireAuth("/rewards");
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("loyalty_request_redemption", {
    p_organization_id: organizationId,
    p_catalog_item_id: catalogItemId,
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

/* ------------------------------------------------------------------ */
/* Optional AI Q&A                                                     */
/* ------------------------------------------------------------------ */

export type ConsultantResult =
  { ok: true; text: string } | { ok: false; message: string };

/**
 * Optional free-form Q&A with the (LLM-backed) Loyalty Advisor, grounded
 * strictly in this org's own program + deterministic stats. It has no
 * authority over any balance — see consultant.ts.
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
    activeProgram: version?.points_per_dollar
      ? { pointsPerDollar: version.points_per_dollar }
      : null,
    stats: stats
      ? {
          members: stats.members,
          pointsIssued: Number(stats.points_issued),
          rewardsRedeemed: Number(stats.rewards_redeemed),
          outstandingPoints: Number(stats.outstanding_points),
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
