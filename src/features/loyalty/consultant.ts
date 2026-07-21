import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  formatBps,
  formatCents,
  type StampProgramEconomics,
} from "@/features/loyalty/engine";
import type { LoyaltyRecommendation } from "@/features/loyalty/advisor";

/**
 * OPTIONAL conversational layer over the deterministic advisor.
 *
 * The language model NEVER produces loyalty economics, balances, or program
 * terms. Every number it may reference is computed in engine.ts / advisor.ts
 * and passed in here as already-formatted facts. The model's only job is to
 * explain those facts in plain language and answer a vendor's follow-up
 * questions. If it is asked to change a program it must refuse and tell the
 * owner to use the publish controls — enforced both in the system prompt and
 * structurally (this module has no write access to anything).
 *
 * Env-gated and fail-closed, mirroring src/lib/geocoding/google-places.ts:
 * absent ANTHROPIC_API_KEY, the free-form Q&A simply isn't offered. The
 * deterministic recommendations and publish flow work with or without it.
 */

const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 1024;

export function isLoyaltyConsultantConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = `You are the CurbAgora Loyalty Advisor, a plain-spoken \
consultant for independent food-cart, food-truck, and small-restaurant owners.

Hard rules you must never break:
- You do NOT set, change, publish, pause, or calculate any loyalty program, \
balance, reward, point, stamp, price, or financial limit. A deterministic \
server-side engine is the sole authority over all of those. If the owner asks \
you to make a change, explain the tradeoff and tell them to use the Publish or \
Pause controls on the page — you cannot do it for them.
- You never invent economic figures. Only reference the numbers provided to \
you in the CONTEXT block. If a number you need isn't there, say you don't have \
it rather than guessing.
- Never claim access to any competitor's private algorithm. You may describe \
general, well-known industry patterns (chains use big point counts and fixed \
catalogs; coffee shops use simple visit/item progress; small restaurants often \
get better economics from menu-item rewards than cash discounts) but always \
label them as common patterns, not guarantees.
- Never present an estimate as a fact. Costs labeled "estimated" are the \
platform's 30%-of-menu-price fallback until the owner enters real cost data.
- No guarantees about revenue or results. Loyalty customers may already be \
more engaged; correlation is not causation.
- Keep answers short, concrete, and free of loyalty-accounting jargon. Favor \
"three more visits" over point math.`;

/** Compact, model-safe summary of one recommendation for the CONTEXT block. */
function recommendationFacts(rec: LoyaltyRecommendation): string {
  const e = rec.economics;
  return [
    `- ${rec.title}`,
    `  earn: ${rec.earnRule}`,
    `  reward: ${rec.rewardRule}`,
    `  visits to first reward: ${rec.economics.visitsToFirstReward}; after: ${rec.economics.visitsPerRewardAfter}`,
    `  customer-perceived rate: ${formatBps(e.perceivedRateBps)}; estimated vendor cost rate: ${formatBps(e.costRateBps)}${e.costIsEstimated ? " (estimated)" : ""}`,
    `  estimated monthly reward cost: ${formatCents(e.monthlyCostLowCents)}–${formatCents(e.monthlyCostHighCents)} (completion-band assumption)`,
  ].join("\n");
}

export type ConsultantContext = {
  recommendations: LoyaltyRecommendation[];
  activeProgram?: {
    stampsRequired: number;
    rewardName: string;
    economics?: StampProgramEconomics;
  } | null;
  stats?: {
    members: number;
    stampsIssued: number;
    rewardsRedeemed: number;
    outstandingStamps: number;
    estimatedLiabilityCents: number;
  } | null;
};

function buildContextBlock(ctx: ConsultantContext): string {
  const parts: string[] = [];
  if (ctx.activeProgram) {
    parts.push(
      `ACTIVE PROGRAM: ${ctx.activeProgram.stampsRequired}-stamp card, reward "${ctx.activeProgram.rewardName}".`,
    );
  } else {
    parts.push("ACTIVE PROGRAM: none published yet.");
  }
  if (ctx.stats) {
    parts.push(
      `STATS: ${ctx.stats.members} members; ${ctx.stats.stampsIssued} stamps issued; ` +
        `${ctx.stats.rewardsRedeemed} rewards redeemed; ${ctx.stats.outstandingStamps} outstanding stamps; ` +
        `estimated outstanding reward liability ${formatCents(ctx.stats.estimatedLiabilityCents)}.`,
    );
  }
  if (ctx.recommendations.length > 0) {
    parts.push(
      "CURRENT DETERMINISTIC RECOMMENDATIONS (the authority — do not alter):\n" +
        ctx.recommendations.map(recommendationFacts).join("\n"),
    );
  }
  return parts.join("\n\n");
}

export type ConsultantReply =
  { ok: true; text: string } | { ok: false; reason: "unconfigured" | "error" };

/**
 * Answer a vendor's free-form loyalty question, grounded strictly in the
 * deterministic context. Returns { ok: false, reason: "unconfigured" } when no
 * API key is present so the caller can hide the free-form box entirely.
 */
export async function askLoyaltyConsultant(
  question: string,
  context: ConsultantContext,
): Promise<ConsultantReply> {
  if (!isLoyaltyConsultantConfigured()) {
    return { ok: false, reason: "unconfigured" };
  }

  const trimmed = question.trim();
  if (!trimmed) {
    return { ok: false, reason: "error" };
  }

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `CONTEXT (the only facts you may cite):\n${buildContextBlock(context)}\n\nVendor question: ${trimmed}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return {
        ok: true,
        text: "I can't help with that one. For anything that changes your program, use the Publish or Pause controls on this page.",
      };
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    return text ? { ok: true, text } : { ok: false, reason: "error" };
  } catch (error) {
    console.error("loyalty consultant request failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, reason: "error" };
  }
}
