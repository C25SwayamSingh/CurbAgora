/**
 * Deterministic Loyalty Advisor: consultation answers in, ranked stamp
 * program recommendations out. Every input appears on screen; every
 * number comes from engine.ts; the scoring rules below are plain code a
 * reviewer can read. The optional language-model layer may rephrase this
 * output — it never generates it.
 */

import {
  PLATFORM_BOUNDS,
  stampProgramEconomics,
  validateStampProgram,
  type StampProgramConfig,
  type StampProgramEconomics,
} from "@/features/loyalty/engine";

export type VisitFrequency = "weekly" | "biweekly" | "monthly" | "unsure";
export type LoyaltyGoal = "repeat_visits" | "slow_hours" | "new_item";
export type ExistingSystem = "none" | "paper" | "square_or_pos" | "other";

export type RewardCandidate = {
  name: string;
  retailCents: number;
  /** Null = "help me estimate" → 30% of retail, labeled as estimated. */
  costCents: number | null;
};

export type ConsultationAnswers = {
  /** Null = skipped; defaults are conservative and labeled. */
  typicalOrderCents: number | null;
  visitFrequency: VisitFrequency;
  goal: LoyaltyGoal;
  rewards: RewardCandidate[];
  monthlyBudgetCents: number | null;
  estimatedMonthlyRegulars: number | null;
  existingSystem: ExistingSystem;
};

export type LoyaltyRecommendation = {
  id: string;
  title: string;
  config: StampProgramConfig;
  economics: StampProgramEconomics;
  earnRule: string;
  rewardRule: string;
  why: string[];
  risks: string[];
  assumptions: string[];
  refundNote: string;
  pauseNote: string;
  fitScore: number;
  budgetFits: boolean | null;
};

const VISITS_PER_MONTH: Record<VisitFrequency, number> = {
  weekly: 4,
  biweekly: 2,
  monthly: 1,
  unsure: 2,
};

/** Round to the nearest 50¢, clamped to platform bounds. */
export function suggestQualifyingMinCents(
  typicalOrderCents: number | null,
): number {
  if (typicalOrderCents === null) return 800;
  const seventyPercent = Math.floor((typicalOrderCents * 70) / 100);
  const rounded = Math.round(seventyPercent / 50) * 50;
  return Math.min(
    PLATFORM_BOUNDS.maxQualifyingCents,
    Math.max(PLATFORM_BOUNDS.minQualifyingCents, rounded),
  );
}

/**
 * Stamp counts worth proposing for a visit cadence: the first reward
 * should land within roughly one to two months of normal behavior.
 */
export function candidateStampCounts(frequency: VisitFrequency): number[] {
  switch (frequency) {
    case "weekly":
      return [6, 8, 5];
    case "biweekly":
      return [5, 6, 4];
    case "monthly":
      return [4, 5];
    case "unsure":
      return [5, 6];
  }
}

function scoreCandidate(
  economics: StampProgramEconomics,
  config: StampProgramConfig,
  answers: ConsultationAnswers,
): { score: number; budgetFits: boolean | null } {
  let score = 100;

  // Cost-rate sweet spot 1–4%: sustainable and still felt by customers.
  if (economics.costRateBps > PLATFORM_BOUNDS.blockCostRateBps) score -= 1000;
  else if (economics.costRateBps > PLATFORM_BOUNDS.warnCostRateBps) score -= 30;
  else if (economics.costRateBps < 50)
    score -= 15; // <0.5% feels stingy
  else if (economics.costRateBps <= 400) score += 20;

  // Perceived value ≥4% keeps the card motivating.
  if (economics.perceivedRateBps >= 400) score += 10;
  else if (economics.perceivedRateBps < 250) score -= 15;

  // Time to first reward: 1–2 months of the vendor's own cadence.
  const visitsPerMonth = VISITS_PER_MONTH[answers.visitFrequency];
  const monthsToFirst = economics.visitsToFirstReward / visitsPerMonth;
  if (monthsToFirst <= 2) score += 15;
  else if (monthsToFirst > 3) score -= 25;

  // Budget compliance uses the HIGH end of the completion band.
  let budgetFits: boolean | null = null;
  if (answers.monthlyBudgetCents !== null) {
    budgetFits = economics.monthlyCostHighCents <= answers.monthlyBudgetCents;
    score += budgetFits ? 15 : -40;
  }

  // Vendor-entered cost data beats estimates.
  if (!economics.costIsEstimated) score += 5;

  // Simplicity default: fewer stamps reads simpler.
  if (config.stampsRequired <= 6) score += 5;

  return { score, budgetFits };
}

export function recommendPrograms(
  answers: ConsultationAnswers,
): LoyaltyRecommendation[] {
  const rewards =
    answers.rewards.length > 0
      ? answers.rewards
      : [{ name: "Free drink", retailCents: 300, costCents: null }];

  const qualifyingMinCents = suggestQualifyingMinCents(
    answers.typicalOrderCents,
  );
  const regulars = answers.estimatedMonthlyRegulars ?? 30;
  const visitsPerMonth = VISITS_PER_MONTH[answers.visitFrequency];

  const recommendations: LoyaltyRecommendation[] = [];

  for (const stamps of candidateStampCounts(answers.visitFrequency)) {
    for (const reward of rewards.slice(0, 2)) {
      const config: StampProgramConfig = {
        stampsRequired: stamps,
        qualifyingMinCents,
        stampPeriodMinutes: 240,
        rewardName: reward.name,
        rewardRetailValueCents: reward.retailCents,
        rewardEstCostCents: reward.costCents,
      };
      const validation = validateStampProgram(config);
      if (validation.errors.length > 0) continue;

      const economics = stampProgramEconomics(config, {
        typicalOrderCents: answers.typicalOrderCents,
        estimatedMonthlyRegulars: regulars,
        estimatedVisitsPerRegularPerMonth: visitsPerMonth,
      });
      const { score, budgetFits } = scoreCandidate(economics, config, answers);

      const why: string[] = [];
      if (answers.goal === "repeat_visits") {
        why.push(
          "A visit-based card directly rewards coming back — your stated goal — instead of order size.",
        );
      }
      if (answers.goal === "slow_hours") {
        why.push(
          "Slow-hour bonus promotions arrive after launch; this card builds the visit habit those promotions will amplify.",
        );
      }
      if (answers.goal === "new_item") {
        why.push(
          `Making "${reward.name}" the reward puts your item in regulars' hands at your marginal cost, not menu price.`,
        );
      }
      if (economics.costRateBps <= 400 && economics.perceivedRateBps >= 350) {
        why.push(
          "The reward reads generous to customers while your estimated real cost stays in the low single digits.",
        );
      }
      why.push(
        `First-visit bonus means a new customer starts at 2 of ${stamps} — early progress is what gets card two started.`,
      );

      const risks: string[] = [...validation.warnings];
      if (economics.costIsEstimated) {
        risks.push(
          "Cost figures are estimates (30% of menu price) until you enter your real cost.",
        );
      }
      if (budgetFits === false) {
        risks.push(
          "At the high end of the completion assumption this exceeds your stated monthly budget.",
        );
      }

      recommendations.push({
        id: `stamps-${stamps}-${reward.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        title: `${stamps}-Visit Regular Card — free ${reward.name}`,
        config,
        economics,
        earnRule: `One stamp per visit with an eligible purchase of at least ${formatMoney(qualifyingMinCents)} (max one stamp per 4 hours).`,
        rewardRule: `${stamps} stamps unlock a free ${reward.name} (menu value ${formatMoney(reward.retailCents)}).`,
        why,
        risks,
        assumptions: [
          answers.typicalOrderCents === null
            ? "Typical order total was skipped — spend figures use the qualifying minimum instead."
            : `Typical order assumed at ${formatMoney(answers.typicalOrderCents)}.`,
          `Roughly ${regulars} active regulars/month${answers.estimatedMonthlyRegulars === null ? " (default estimate)" : ""}, about ${visitsPerMonth} visit(s) each.`,
          "Completion band 40–70% of earned cards — an assumption to validate, not a fact.",
        ],
        refundNote:
          "If a purchase is refunded, you (or a manager) reverse that stamp from the customer's history — reversals are one tap and fully audited.",
        pauseNote:
          "Pausing stops new stamps but never erases earned progress; customers can still redeem unless you pause redemptions too.",
        fitScore: score,
        budgetFits,
      });
    }
  }

  recommendations.sort((a, b) => b.fitScore - a.fitScore);
  // Two or three options, never an overwhelming list.
  return recommendations.slice(0, 3);
}

/** Advice about coexisting with an existing loyalty setup. */
export function existingSystemAdvice(system: ExistingSystem): string | null {
  switch (system) {
    case "paper":
      return "Keep honoring outstanding paper cards until they're redeemed, and hand new customers the digital card. Running both briefly is normal — announce a cut-over date once most regulars have switched.";
    case "square_or_pos":
      return "Your POS loyalty keeps working at the register. CurbAgora's card is strongest for discovery-driven new regulars who find you here — many vendors run it as a complement rather than migrating existing balances.";
    case "other":
      return "You can run CurbAgora's card alongside your current system. Avoid double-rewarding the same purchase: pick one system per transaction.";
    case "none":
      return null;
  }
}

function formatMoney(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const rem = cents % 100;
  return rem === 0
    ? `$${dollars}`
    : `$${dollars}.${String(rem).padStart(2, "0")}`;
}
