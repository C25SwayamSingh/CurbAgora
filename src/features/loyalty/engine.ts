/**
 * Deterministic loyalty economics for the stamp-card template.
 *
 * All money is INTEGER CENTS; all rates are INTEGER BASIS POINTS
 * (1 bp = 0.01%). No floating-point money anywhere. These functions are
 * the advisor's authority: the optional language-model layer may explain
 * these numbers but never produces them.
 *
 * Platform bounds here mirror — but do not replace — the hard checks in
 * supabase/migrations/20260713000000_loyalty_foundation.sql. The database
 * function loyalty_publish_program() re-validates everything.
 */

export const PLATFORM_BOUNDS = {
  minStamps: 4,
  maxStamps: 10,
  minQualifyingCents: 100,
  maxQualifyingCents: 10000,
  minStampPeriodMinutes: 60,
  /** Publication is blocked above this vendor cost rate (basis points). */
  blockCostRateBps: 1000, // 10%
  /** Strong warning above this vendor cost rate (basis points). */
  warnCostRateBps: 500, // 5%
} as const;

/** When the vendor hasn't entered a cost, estimate 30% of retail. */
export const DEFAULT_COST_RATIO_PERCENT = 30;

/** Labeled completion-rate assumption band for liability planning. */
export const COMPLETION_RATE_LOW_BPS = 4000; // 40%
export const COMPLETION_RATE_HIGH_BPS = 7000; // 70%

export type StampProgramConfig = {
  stampsRequired: number;
  qualifyingMinCents: number;
  stampPeriodMinutes: number;
  rewardName: string;
  rewardRetailValueCents: number;
  /** Null = vendor hasn't provided cost data; estimates are used and labeled. */
  rewardEstCostCents: number | null;
};

export type StampProgramEconomics = {
  /** Whether the cost figures are vendor-entered or a labeled estimate. */
  costIsEstimated: boolean;
  effectiveCostCents: number;
  /** Conservative qualifying spend before a reward (typical order × stamps). */
  qualifyingSpendCents: number;
  /** Same figure for the FIRST card, where the first-visit bonus saves one visit. */
  firstCardSpendCents: number;
  /** Customer-perceived reward rate, basis points of qualifying spend. */
  perceivedRateBps: number;
  /** Vendor's estimated real cost rate, basis points of qualifying spend. */
  costRateBps: number;
  /** Visits to the first reward (first-visit bonus included) and after. */
  visitsToFirstReward: number;
  visitsPerRewardAfter: number;
  /** Monthly cost band given an estimated number of active regulars. */
  monthlyCostLowCents: number;
  monthlyCostHighCents: number;
  monthlyCostWorstCaseCents: number;
};

function assertInt(value: number, label: string) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer (got ${value})`);
  }
}

/** Basis points of part/whole using integer math only. */
export function rateBps(partCents: number, wholeCents: number): number {
  assertInt(partCents, "partCents");
  assertInt(wholeCents, "wholeCents");
  if (wholeCents <= 0) return 0;
  return Math.floor((partCents * 10000) / wholeCents);
}

export function estimateRewardCostCents(
  retailCents: number,
  enteredCostCents: number | null,
): { costCents: number; estimated: boolean } {
  assertInt(retailCents, "retailCents");
  if (enteredCostCents !== null) {
    assertInt(enteredCostCents, "enteredCostCents");
    return { costCents: enteredCostCents, estimated: false };
  }
  return {
    costCents: Math.floor((retailCents * DEFAULT_COST_RATIO_PERCENT) / 100),
    estimated: true,
  };
}

export function stampProgramEconomics(
  config: StampProgramConfig,
  context: {
    /** Vendor's typical order total; falls back to the qualifying minimum. */
    typicalOrderCents: number | null;
    /** Rough count of repeat customers active in a month. */
    estimatedMonthlyRegulars: number;
    /** Average qualifying visits per regular per month. */
    estimatedVisitsPerRegularPerMonth: number;
  },
): StampProgramEconomics {
  const orderCents = context.typicalOrderCents ?? config.qualifyingMinCents;
  assertInt(orderCents, "typicalOrderCents");

  const { costCents, estimated } = estimateRewardCostCents(
    config.rewardRetailValueCents,
    config.rewardEstCostCents,
  );

  const qualifyingSpendCents = config.stampsRequired * orderCents;
  const firstCardSpendCents = (config.stampsRequired - 1) * orderCents;

  // Rewards completed per regular per month = visits / stamps (floored to
  // avoid promising fractional rewards); cost band applies the labeled
  // completion assumption.
  const rewardsPerRegularPerMonthTimes100 = Math.floor(
    (context.estimatedVisitsPerRegularPerMonth * 100) / config.stampsRequired,
  );
  const worstCase = Math.ceil(
    (context.estimatedMonthlyRegulars *
      rewardsPerRegularPerMonthTimes100 *
      costCents) /
      100,
  );

  return {
    costIsEstimated: estimated,
    effectiveCostCents: costCents,
    qualifyingSpendCents,
    firstCardSpendCents,
    perceivedRateBps: rateBps(
      config.rewardRetailValueCents,
      qualifyingSpendCents,
    ),
    costRateBps: rateBps(costCents, qualifyingSpendCents),
    visitsToFirstReward: config.stampsRequired - 1,
    visitsPerRewardAfter: config.stampsRequired,
    monthlyCostLowCents: Math.floor(
      (worstCase * COMPLETION_RATE_LOW_BPS) / 10000,
    ),
    monthlyCostHighCents: Math.floor(
      (worstCase * COMPLETION_RATE_HIGH_BPS) / 10000,
    ),
    monthlyCostWorstCaseCents: worstCase,
  };
}

export type ProgramValidation = {
  errors: string[];
  warnings: string[];
};

/** Mirrors the database's hard bounds and adds UX-level warnings. */
export function validateStampProgram(
  config: StampProgramConfig,
): ProgramValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const b = PLATFORM_BOUNDS;

  if (
    !Number.isInteger(config.stampsRequired) ||
    config.stampsRequired < b.minStamps ||
    config.stampsRequired > b.maxStamps
  ) {
    errors.push(
      `Stamps required must be between ${b.minStamps} and ${b.maxStamps}.`,
    );
  }
  if (
    !Number.isInteger(config.qualifyingMinCents) ||
    config.qualifyingMinCents < b.minQualifyingCents ||
    config.qualifyingMinCents > b.maxQualifyingCents
  ) {
    errors.push("Qualifying minimum must be between $1 and $100.");
  }
  if (
    !Number.isInteger(config.stampPeriodMinutes) ||
    config.stampPeriodMinutes < b.minStampPeriodMinutes
  ) {
    errors.push("Stamp frequency limit must be at least 60 minutes.");
  }
  if (!config.rewardName.trim()) {
    errors.push("Name the reward customers are working toward.");
  }
  if (
    !Number.isInteger(config.rewardRetailValueCents) ||
    config.rewardRetailValueCents <= 0
  ) {
    errors.push("Enter the reward's menu price.");
  }

  if (errors.length > 0) return { errors, warnings };

  const { costCents } = estimateRewardCostCents(
    config.rewardRetailValueCents,
    config.rewardEstCostCents,
  );
  const conservativeSpend = config.stampsRequired * config.qualifyingMinCents;
  const costRate = rateBps(costCents, conservativeSpend);

  if (costRate > b.blockCostRateBps) {
    errors.push(
      "This reward costs more than 10% of the qualifying spend — the platform blocks publishing at this level. Lower the reward cost or raise the requirement.",
    );
  } else if (costRate > b.warnCostRateBps) {
    warnings.push(
      "This reward costs more than 5% of qualifying spend. That can work for a launch push, but check it against your monthly budget.",
    );
  }

  if (config.stampsRequired >= 9) {
    warnings.push(
      "Nine or more stamps is a long road — many customers disengage before their first reward.",
    );
  }
  if (config.stampsRequired <= 4) {
    warnings.push(
      "Four stamps is generous. Great for launch, but watch cost and one-per-period abuse.",
    );
  }
  if (config.rewardEstCostCents === null) {
    warnings.push(
      "You haven't entered your cost for this reward — economics shown use an estimate of 30% of its menu price.",
    );
  }

  return { errors, warnings };
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars}.${String(rem).padStart(2, "0")}`;
}

export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const tenth = Math.floor((bps % 100) / 10);
  return tenth === 0 ? `${whole}%` : `${whole}.${tenth}%`;
}
