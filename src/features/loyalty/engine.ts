/**
 * Deterministic loyalty economics — spend-based points model.
 *
 * All money is INTEGER CENTS; all rates are INTEGER BASIS POINTS
 * (1 bp = 0.01%). No floating-point money anywhere. This module is the
 * financial authority: the AI advisor may interpret answers, estimate
 * missing inputs, and explain tradeoffs, but every number a vendor sees
 * and every publication block is computed here.
 *
 * Points are earned on VERIFIED eligible spend (a staff member enters the
 * subtotal at the counter), then redeemed against a controlled reward
 * catalog. Platform bounds mirror — but do not replace — the hard checks in
 * supabase/migrations/20260715000000_loyalty_points.sql, whose
 * loyalty_publish_program() re-validates every tier independently.
 */

export const POINTS_BOUNDS = {
  minPointsPerDollar: 1,
  maxPointsPerDollar: 100,
  minCatalogItems: 1,
  maxCatalogItems: 6,
  /** Publication is blocked above this vendor cost rate (basis points). */
  blockCostRateBps: 1000, // 10%
  /** Strong warning above this vendor cost rate (basis points). */
  warnCostRateBps: 500, // 5%
} as const;

/**
 * A fixed discount and a free item are not comparable, so they are not judged
 * by the same number.
 *
 * $3 off costs the vendor $3 — the customer's gain and the vendor's loss are
 * the same figure, so the only lever is how much they must spend to get it. A
 * free $3.50 drink might cost $0.90 in ingredients, so it can feel twice as
 * generous while costing a third as much. Holding both to one threshold either
 * makes discounts look affordable when they aren't, or makes item rewards look
 * reckless when they're the better instrument.
 */
export const DISCOUNT_LIMITS = {
  /** Comfortable customer-facing return for a cash discount. */
  suggestLowBps: 400, // 4%
  suggestHighBps: 600, // 6%
  /** Above this the discount is unusually generous for a cash-value reward. */
  warnBps: 750, // 7.5%
} as const;

export const FREE_ITEM_LIMITS = {
  /** What the reward should feel worth to the customer. */
  perceivedLowBps: 600, // 6%
  perceivedHighBps: 1000, // 10%
  /** What it should actually cost the vendor. */
  costLowBps: 150, // 1.5%
  costHighBps: 400, // 4%
} as const;

/** When the vendor hasn't entered an item cost, estimate this share of retail. */
export const DEFAULT_COST_RATIO_PERCENT = 30;

/** Labeled completion-rate assumption band for liability planning. */
export const COMPLETION_RATE_LOW_BPS = 4000; // 40%
export const COMPLETION_RATE_HIGH_BPS = 7000; // 70%

/**
 * Weeks per month × 100 (52 / 12 = 4.3333). The single documented constant
 * for every weekly→monthly conversion, so the two time bases never mix
 * silently. Surfaced to the vendor wherever a conversion happens.
 */
export const WEEKS_PER_MONTH_X100 = 433;
export const WEEKS_PER_MONTH_LABEL = "4.33 weeks per month (52 ÷ 12)";

/* ------------------------------------------------------------------ */
/* Input provenance                                                    */
/* ------------------------------------------------------------------ */

/**
 * Where a number came from. Surfaced in every recommendation's assumptions
 * so an owner can tell their own figures from the platform's fallbacks.
 */
export type ValueSource = "provided" | "estimated" | "skipped" | "unavailable";

export type Tracked<T> = { value: T; source: ValueSource };

export function tracked<T>(value: T, source: ValueSource): Tracked<T> {
  return { value, source };
}

export function sourceLabel(source: ValueSource): string {
  switch (source) {
    case "provided":
      return "your figure";
    case "estimated":
      return "estimated";
    case "skipped":
      return "skipped";
    case "unavailable":
      return "not available yet";
  }
}

/* ------------------------------------------------------------------ */
/* Reward modeling                                                     */
/* ------------------------------------------------------------------ */

export type RewardKind = "FREE_ITEM" | "FIXED_DISCOUNT";

/**
 * A reward the customer redeems points for. Discriminated on `kind` so new
 * reward types can be added later without any caller silently mis-modeling an
 * existing one. FREE_ITEM has cost leverage (menu price ≫ vendor cost);
 * FIXED_DISCOUNT costs its full face value.
 */
export type RewardSpec =
  | {
      kind: "FREE_ITEM";
      name: string;
      retailCents: number;
      unitCostCents: number | null;
    }
  | {
      kind: "FIXED_DISCOUNT";
      name: string;
      discountCents: number;
    };

export type RewardEconomics = {
  kind: RewardKind;
  customerValueCents: number;
  vendorCostCents: number;
  costSource: ValueSource;
  modelNote: string;
};

function assertInt(value: number, label: string) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer (got ${value})`);
  }
}

export function rewardEconomics(reward: RewardSpec): RewardEconomics {
  if (reward.kind === "FREE_ITEM") {
    assertInt(reward.retailCents, "retailCents");
    const entered = reward.unitCostCents;
    if (entered !== null) assertInt(entered, "unitCostCents");
    const cost =
      entered !== null
        ? entered
        : Math.floor((reward.retailCents * DEFAULT_COST_RATIO_PERCENT) / 100);
    return {
      kind: "FREE_ITEM",
      customerValueCents: reward.retailCents,
      vendorCostCents: cost,
      costSource: entered !== null ? "provided" : "estimated",
      modelNote:
        entered !== null
          ? `Free item: customers see the ${formatCents(reward.retailCents)} menu price, and you pay your own cost of ${formatCents(cost)}.`
          : `Free item. You haven't entered your cost, so this uses ${DEFAULT_COST_RATIO_PERCENT}% of the menu price (${formatCents(cost)}) — an estimate, not your real cost.`,
    };
  }

  assertInt(reward.discountCents, "discountCents");
  return {
    kind: "FIXED_DISCOUNT",
    customerValueCents: reward.discountCents,
    vendorCostCents: reward.discountCents,
    costSource: "provided",
    modelNote: `Fixed discount: ${formatCents(reward.discountCents)} off costs you the full ${formatCents(reward.discountCents)} in foregone revenue — no cheaper-than-menu-price ingredient behind it.`,
  };
}

export function rewardKindLabel(kind: RewardKind): string {
  return kind === "FREE_ITEM" ? "Free item" : "Fixed discount";
}

/**
 * Customer-facing wording for a reward, used by every surface so they never
 * disagree. A discount reads as the money off (its name is an internal label);
 * a free item gets a "Free " prefix unless the vendor already typed one, so
 * "Free drink" never renders as "Free Free drink".
 */
export function rewardDisplayLabel(
  kind: RewardKind,
  name: string,
  valueCents: number,
): string {
  if (kind === "FIXED_DISCOUNT") return `${formatCents(valueCents)} off`;
  const trimmed = name.trim();
  return /^free\b/i.test(trimmed) ? trimmed : `Free ${trimmed}`;
}

/* ------------------------------------------------------------------ */
/* Program configuration                                               */
/* ------------------------------------------------------------------ */

export type CatalogItemConfig = {
  pointsCost: number;
  reward: RewardSpec;
};

export type PointsProgramConfig = {
  pointsPerDollar: number;
  catalog: CatalogItemConfig[];
};

/**
 * Business context for projections. Every field carries provenance; the two
 * recurring quantities use explicitly different time bases: visits are per
 * WEEK per regular; the customer count is per MONTH.
 */
export type EconomicsContext = {
  typicalOrderCents: Tracked<number | null>;
  regularsPerMonth: Tracked<number>;
  /** Visits per WEEK per regular, ×100 (100 = once a week). */
  visitsPerWeekX100: Tracked<number>;
};

/** Basis points of part/whole using integer math only. */
export function rateBps(partCents: number, wholeCents: number): number {
  assertInt(partCents, "partCents");
  assertInt(wholeCents, "wholeCents");
  if (wholeCents <= 0) return 0;
  return Math.floor((partCents * 10000) / wholeCents);
}

export type CatalogItemEconomics = {
  pointsCost: number;
  reward: RewardEconomics;
  /** Eligible spend needed to reach this reward, in cents. */
  spendToEarnCents: number;
  /** Customer-perceived reward rate at this tier, basis points. */
  perceivedRateBps: number;
  /** Vendor cost rate at this tier, basis points. */
  costRateBps: number;
};

/** Spend to earn = pointsCost ÷ pointsPerDollar dollars, in cents. */
export function catalogItemEconomics(
  item: CatalogItemConfig,
  pointsPerDollar: number,
): CatalogItemEconomics {
  assertInt(item.pointsCost, "pointsCost");
  assertInt(pointsPerDollar, "pointsPerDollar");
  const reward = rewardEconomics(item.reward);
  const spendToEarnCents =
    pointsPerDollar > 0
      ? Math.floor((item.pointsCost * 100) / pointsPerDollar)
      : 0;
  return {
    pointsCost: item.pointsCost,
    reward,
    spendToEarnCents,
    perceivedRateBps: rateBps(reward.customerValueCents, spendToEarnCents),
    costRateBps: rateBps(reward.vendorCostCents, spendToEarnCents),
  };
}

export type PointsProgramEconomics = {
  pointsPerDollar: number;
  items: CatalogItemEconomics[];
  /** The cheapest (entry) tier — the first reward a customer reaches. */
  entry: CatalogItemEconomics;
  /** Points a regular earns per month at the stated spend & cadence. */
  monthlyPointsPerRegular: number;
  /** Whole entry-tier rewards a regular can earn per month. */
  /** Rewards one regular earns per month, ×10000 (0.865/month → 8650). */
  entryRewardsPerRegularPerMonthX10000: number;
  /** Monthly reward-cost band across all regulars, at the entry tier. */
  monthlyCostLowCents: number;
  monthlyCostHighCents: number;
  monthlyCostWorstCaseCents: number;
  /** The weekly→monthly conversion actually applied, for display. */
  conversionNote: string;
};

export function pointsProgramEconomics(
  config: PointsProgramConfig,
  context: EconomicsContext,
): PointsProgramEconomics {
  const items = config.catalog.map((c) =>
    catalogItemEconomics(c, config.pointsPerDollar),
  );
  const entry = items.reduce((lo, it) =>
    it.pointsCost < lo.pointsCost ? it : lo,
  );

  const orderCents = context.typicalOrderCents.value ?? 0;
  // visits/month = visits/week × weeks/month; both operands are ×100.
  const visitsPerMonthX100 = Math.floor(
    (context.visitsPerWeekX100.value * WEEKS_PER_MONTH_X100) / 100,
  );
  // Monthly spend per regular (cents) = typical order × visits/month.
  const monthlySpendPerRegularCents = Math.floor(
    (orderCents * visitsPerMonthX100) / 100,
  );
  const monthlyPointsPerRegular = Math.floor(
    (monthlySpendPerRegularCents * config.pointsPerDollar) / 100,
  );
  // Scaled ×10000, NOT floored to a whole reward.
  //
  // A regular earning 519 points a month against a 600-point reward collects
  // one roughly every five weeks. Flooring that to "0 rewards per month"
  // reported the entire program as costing nothing — which silently disarmed
  // the budget guard below, so a $15 budget looked comfortable against a real
  // exposure of hundreds. Any reward priced above one month of a regular's
  // earning had this problem, which is most of them.
  const entryRewardsPerRegularPerMonthX10000 =
    entry.pointsCost > 0
      ? Math.floor((monthlyPointsPerRegular * 10000) / entry.pointsCost)
      : 0;

  const worstCase = Math.floor(
    (context.regularsPerMonth.value *
      entryRewardsPerRegularPerMonthX10000 *
      entry.reward.vendorCostCents) /
      10000,
  );

  return {
    pointsPerDollar: config.pointsPerDollar,
    items,
    entry,
    monthlyPointsPerRegular,
    entryRewardsPerRegularPerMonthX10000,
    monthlyCostLowCents: Math.floor(
      (worstCase * COMPLETION_RATE_LOW_BPS) / 10000,
    ),
    monthlyCostHighCents: Math.floor(
      (worstCase * COMPLETION_RATE_HIGH_BPS) / 10000,
    ),
    monthlyCostWorstCaseCents: worstCase,
    conversionNote: `Visits converted weekly→monthly using ${WEEKS_PER_MONTH_LABEL}: ${formatX100(context.visitsPerWeekX100.value)} visits/week ≈ ${formatX100(visitsPerMonthX100)} visits/month per regular.`,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type IssueSeverity = "block" | "warning";

export type ProgramIssue = {
  severity: IssueSeverity;
  code: string;
  message: string;
  calculation?: string;
  remedy?: string;
};

export type ProgramValidation = {
  issues: ProgramIssue[];
  blocked: boolean;
};

export function blockingIssues(v: ProgramValidation): ProgramIssue[] {
  return v.issues.filter((i) => i.severity === "block");
}

export function warningIssues(v: ProgramValidation): ProgramIssue[] {
  return v.issues.filter((i) => i.severity === "warning");
}

/** Mirrors the database's hard bounds and adds UX-level warnings. */
export function validatePointsProgram(
  config: PointsProgramConfig,
): ProgramValidation {
  const issues: ProgramIssue[] = [];
  const b = POINTS_BOUNDS;

  if (
    !Number.isInteger(config.pointsPerDollar) ||
    config.pointsPerDollar < b.minPointsPerDollar ||
    config.pointsPerDollar > b.maxPointsPerDollar
  ) {
    issues.push({
      severity: "block",
      code: "points_per_dollar_out_of_range",
      message: `Points per dollar must be between ${b.minPointsPerDollar} and ${b.maxPointsPerDollar}.`,
    });
  }
  if (
    config.catalog.length < b.minCatalogItems ||
    config.catalog.length > b.maxCatalogItems
  ) {
    issues.push({
      severity: "block",
      code: "catalog_size",
      message: `The reward catalog must have between ${b.minCatalogItems} and ${b.maxCatalogItems} rewards.`,
    });
  }

  config.catalog.forEach((item, i) => {
    const label = item.reward.name.trim() || `reward ${i + 1}`;
    if (!item.reward.name.trim()) {
      issues.push({
        severity: "block",
        code: "reward_unnamed",
        message: `Name reward ${i + 1}.`,
      });
    }
    if (!Number.isInteger(item.pointsCost) || item.pointsCost <= 0) {
      issues.push({
        severity: "block",
        code: "points_cost_invalid",
        message: `“${label}” needs a positive points cost.`,
      });
    }
    const value =
      item.reward.kind === "FREE_ITEM"
        ? item.reward.retailCents
        : item.reward.discountCents;
    if (!Number.isInteger(value) || value <= 0) {
      issues.push({
        severity: "block",
        code: "reward_value_invalid",
        message: `“${label}” needs a positive ${item.reward.kind === "FREE_ITEM" ? "menu price" : "discount amount"}.`,
      });
    }
  });

  if (issues.some((i) => i.severity === "block")) {
    return { issues, blocked: true };
  }

  // Per-tier cost cap, kind-aware.
  config.catalog.forEach((item) => {
    const e = catalogItemEconomics(item, config.pointsPerDollar);
    const label = item.reward.name.trim();
    const calc = `${item.pointsCost} pts ÷ ${config.pointsPerDollar} pts/$ = ${formatCents(e.spendToEarnCents)} spend; reward cost ${formatCents(e.reward.vendorCostCents)} = ${formatBps(e.costRateBps)}`;
    if (e.costRateBps > b.blockCostRateBps) {
      issues.push({
        severity: "block",
        code: "cost_rate_over_cap",
        message: `“${label}” would cost ${formatBps(e.costRateBps)} of the spend needed to earn it, above the platform's ${formatBps(b.blockCostRateBps)} limit.`,
        calculation: calc,
        remedy:
          "Raise its points cost, lower its cost, or raise points per dollar.",
      });
    } else if (e.costRateBps > b.warnCostRateBps) {
      issues.push({
        severity: "warning",
        code: "cost_rate_elevated",
        message: `“${label}” costs ${formatBps(e.costRateBps)} of the spend to earn it — above the ${formatBps(b.warnCostRateBps)} comfort line.`,
        calculation: calc,
      });
    }
    if (item.reward.kind === "FIXED_DISCOUNT") {
      issues.push({
        severity: "warning",
        code: "discount_no_leverage",
        message: `“${label}” is a fixed discount — it costs you its full face value, unlike a free item.`,
      });
      // For a discount, perceived value and vendor cost are the same number,
      // so the return rate is the whole story. Compared against published
      // chain programs rather than an internal preference.
      if (e.perceivedRateBps > DISCOUNT_LIMITS.warnBps) {
        issues.push({
          severity: "warning",
          code: "discount_return_high",
          message: `“${label}” gives back ${formatBps(e.perceivedRateBps)} — more generous than any major chain's cash reward, and it all comes out of your margin.`,
          calculation: calc,
          remedy: `Most chains sit between ${formatBps(DISCOUNT_LIMITS.suggestLowBps)} and ${formatBps(DISCOUNT_LIMITS.suggestHighBps)}. Raise its points cost to bring it into that range.`,
        });
      }
    } else if (
      e.reward.costSource === "provided" &&
      e.costRateBps > FREE_ITEM_LIMITS.costHighBps &&
      e.costRateBps <= b.warnCostRateBps
    ) {
      // A free item's whole advantage is costing less than it's worth. When
      // its real cost climbs toward discount territory, that advantage is
      // gone and the owner should know before publishing.
      issues.push({
        severity: "warning",
        code: "free_item_cost_high",
        message: `“${label}” costs you ${formatBps(e.costRateBps)} — high for a menu item, where ${formatBps(FREE_ITEM_LIMITS.costLowBps)}–${formatBps(FREE_ITEM_LIMITS.costHighBps)} is typical. A cheaper item would feel just as generous.`,
        calculation: calc,
      });
    }
    if (e.reward.costSource === "estimated") {
      issues.push({
        severity: "warning",
        code: "cost_estimated",
        message: `“${label}” uses an estimated cost (${DEFAULT_COST_RATIO_PERCENT}% of menu price). Enter your real cost for accurate figures.`,
      });
    }
  });

  return { issues, blocked: issues.some((i) => i.severity === "block") };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

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

export function formatX100(x100: number): string {
  const whole = Math.floor(x100 / 100);
  const frac = x100 % 100;
  return frac === 0 ? `${whole}` : `${whole}.${String(frac).padStart(2, "0")}`;
}

/** Integer points with thousands separators. */
export function formatPoints(points: number): string {
  return `${points.toLocaleString("en-US")} pts`;
}
