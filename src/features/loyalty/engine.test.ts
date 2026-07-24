import { describe, expect, it } from "vitest";

import {
  COMPLETION_RATE_HIGH_BPS,
  DEFAULT_COST_RATIO_PERCENT,
  POINTS_BOUNDS,
  WEEKS_PER_MONTH_X100,
  blockingIssues,
  catalogItemEconomics,
  formatBps,
  formatCents,
  formatPoints,
  formatX100,
  pointsProgramEconomics,
  rateBps,
  rewardEconomics,
  rewardKindLabel,
  sourceLabel,
  tracked,
  validatePointsProgram,
  warningIssues,
  type EconomicsContext,
  type PointsProgramConfig,
  type RewardSpec,
} from "@/features/loyalty/engine";

const freeItem: RewardSpec = {
  kind: "FREE_ITEM",
  name: "Horchata",
  retailCents: 350,
  unitCostCents: 90,
};

const baseConfig: PointsProgramConfig = {
  pointsPerDollar: 10,
  catalog: [{ pointsCost: 700, reward: freeItem }],
};

const baseContext: EconomicsContext = {
  typicalOrderCents: tracked(1200, "provided"),
  regularsPerMonth: tracked(30, "provided"),
  visitsPerWeekX100: tracked(100, "provided"),
};

describe("rateBps", () => {
  it("computes integer basis points with floor semantics", () => {
    expect(rateBps(90, 7000)).toBe(128); // 1.28%
  });

  it("returns 0 for a non-positive whole", () => {
    expect(rateBps(90, 0)).toBe(0);
  });

  it("throws on non-integer inputs (no floating-point money)", () => {
    expect(() => rateBps(90.5, 7000)).toThrow();
  });
});

describe("rewardEconomics — FREE_ITEM", () => {
  it("uses the entered marginal cost and keeps leverage", () => {
    const r = rewardEconomics(freeItem);
    expect(r.customerValueCents).toBe(350);
    expect(r.vendorCostCents).toBe(90);
    expect(r.costSource).toBe("provided");
    expect(r.customerValueCents).toBeGreaterThan(r.vendorCostCents);
  });

  it("falls back to a labeled 30%-of-retail estimate", () => {
    const r = rewardEconomics({ ...freeItem, unitCostCents: null });
    expect(r.vendorCostCents).toBe(
      Math.floor((350 * DEFAULT_COST_RATIO_PERCENT) / 100),
    );
    expect(r.costSource).toBe("estimated");
    expect(r.modelNote).toMatch(/estimate/i);
  });
});

describe("rewardEconomics — FIXED_DISCOUNT", () => {
  const discount: RewardSpec = {
    kind: "FIXED_DISCOUNT",
    name: "$5 off",
    discountCents: 500,
  };

  it("costs the vendor its full face value — no item-cost leverage", () => {
    const r = rewardEconomics(discount);
    expect(r.customerValueCents).toBe(500);
    expect(r.vendorCostCents).toBe(500);
  });

  it("never applies the 30% free-item fallback to a discount", () => {
    expect(rewardEconomics(discount).vendorCostCents).not.toBe(
      Math.floor((500 * DEFAULT_COST_RATIO_PERCENT) / 100),
    );
  });

  it("explains the absence of leverage", () => {
    expect(rewardEconomics(discount).modelNote).toMatch(/foregone revenue/i);
  });

  it("labels each kind distinctly", () => {
    expect(rewardKindLabel("FREE_ITEM")).toBe("Free item");
    expect(rewardKindLabel("FIXED_DISCOUNT")).toBe("Fixed discount");
  });
});

describe("the $10 item / $6 cost / half-off regression", () => {
  it("values half-off at the $5 the customer saves, costing the full $5", () => {
    const asDiscount: RewardSpec = {
      kind: "FIXED_DISCOUNT",
      name: "Half off an item",
      discountCents: 500,
    };
    const r = rewardEconomics(asDiscount);
    expect(r.customerValueCents).toBe(500);
    expect(r.vendorCostCents).toBe(500);
  });
});

describe("catalogItemEconomics", () => {
  it("derives spend-to-earn from points ÷ points-per-dollar", () => {
    // 700 pts ÷ 10 pts/$ = $70.00
    const e = catalogItemEconomics({ pointsCost: 700, reward: freeItem }, 10);
    expect(e.spendToEarnCents).toBe(7000);
  });

  it("computes perceived and cost rates against that spend", () => {
    const e = catalogItemEconomics({ pointsCost: 700, reward: freeItem }, 10);
    expect(e.perceivedRateBps).toBe(rateBps(350, 7000)); // 5%
    expect(e.costRateBps).toBe(rateBps(90, 7000)); // ~1.28%
    expect(e.perceivedRateBps).toBeGreaterThan(e.costRateBps);
  });

  it("scales spend-to-earn with the points scale", () => {
    // Same reward at 100 pts/$ needs the same dollars for 10× the points.
    const a = catalogItemEconomics({ pointsCost: 700, reward: freeItem }, 10);
    const b = catalogItemEconomics({ pointsCost: 7000, reward: freeItem }, 100);
    expect(a.spendToEarnCents).toBe(b.spendToEarnCents);
  });

  it("charges a discount far more than an equal-value free item", () => {
    const item = catalogItemEconomics(
      { pointsCost: 700, reward: freeItem },
      10,
    );
    const disc = catalogItemEconomics(
      {
        pointsCost: 700,
        reward: {
          kind: "FIXED_DISCOUNT",
          name: "$3.50 off",
          discountCents: 350,
        },
      },
      10,
    );
    expect(disc.perceivedRateBps).toBe(item.perceivedRateBps);
    expect(disc.costRateBps).toBeGreaterThan(item.costRateBps);
  });
});

describe("pointsProgramEconomics", () => {
  const economics = pointsProgramEconomics(baseConfig, baseContext);

  it("picks the cheapest tier as the entry reward", () => {
    const multi = pointsProgramEconomics(
      {
        pointsPerDollar: 10,
        catalog: [
          { pointsCost: 900, reward: freeItem },
          { pointsCost: 400, reward: freeItem },
        ],
      },
      baseContext,
    );
    expect(multi.entry.pointsCost).toBe(400);
  });

  it("converts weekly visits to monthly with the documented constant", () => {
    expect(WEEKS_PER_MONTH_X100).toBe(433);
    expect(economics.conversionNote).toMatch(/4\.33 weeks per month/);
  });

  it("earns points from monthly spend at the configured scale", () => {
    // $12 × 4.33 visits ≈ $51.96/month → ~519 points at 10 pts/$.
    expect(economics.monthlyPointsPerRegular).toBeGreaterThan(500);
    expect(economics.monthlyPointsPerRegular).toBeLessThan(530);
  });

  it("orders the monthly cost band low ≤ high ≤ worst case, all integers", () => {
    expect(economics.monthlyCostLowCents).toBeLessThanOrEqual(
      economics.monthlyCostHighCents,
    );
    expect(economics.monthlyCostHighCents).toBeLessThanOrEqual(
      economics.monthlyCostWorstCaseCents,
    );
    for (const v of [
      economics.monthlyCostLowCents,
      economics.monthlyCostHighCents,
      economics.monthlyCostWorstCaseCents,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("projects no monthly exposure when the order total was skipped", () => {
    const skipped = pointsProgramEconomics(baseConfig, {
      ...baseContext,
      typicalOrderCents: tracked(null, "skipped"),
    });
    expect(skipped.monthlyPointsPerRegular).toBe(0);
    expect(skipped.monthlyCostWorstCaseCents).toBe(0);
  });
});

describe("validatePointsProgram", () => {
  it("accepts a sane config with no blocks", () => {
    const v = validatePointsProgram(baseConfig);
    expect(v.blocked).toBe(false);
    expect(blockingIssues(v)).toHaveLength(0);
  });

  it("blocks points-per-dollar outside platform bounds", () => {
    expect(
      validatePointsProgram({ ...baseConfig, pointsPerDollar: 0 }).blocked,
    ).toBe(true);
    expect(
      validatePointsProgram({ ...baseConfig, pointsPerDollar: 500 }).blocked,
    ).toBe(true);
  });

  it("blocks an empty catalog", () => {
    expect(validatePointsProgram({ ...baseConfig, catalog: [] }).blocked).toBe(
      true,
    );
  });

  it("blocks a tier whose cost exceeds 10% of the spend to earn it", () => {
    // 100 pts ÷ 10 = $10 spend; a $6 reward = 60%.
    const v = validatePointsProgram({
      pointsPerDollar: 10,
      catalog: [
        {
          pointsCost: 100,
          reward: {
            kind: "FREE_ITEM",
            name: "Plate",
            retailCents: 1000,
            unitCostCents: 600,
          },
        },
      ],
    });
    expect(v.blocked).toBe(true);
    const issue = blockingIssues(v).find(
      (i) => i.code === "cost_rate_over_cap",
    );
    expect(issue?.calculation).toMatch(/pts ÷/);
    expect(issue?.remedy).toBeTruthy();
  });

  it("warns between the 5% and 10% lines without blocking", () => {
    // 150 pts ÷ 10 = $15 spend; $0.90 cost = 6%.
    const v = validatePointsProgram({
      pointsPerDollar: 10,
      catalog: [{ pointsCost: 150, reward: freeItem }],
    });
    expect(v.blocked).toBe(false);
    expect(warningIssues(v).some((i) => i.code === "cost_rate_elevated")).toBe(
      true,
    );
  });

  it("always warns that a fixed discount has no leverage", () => {
    const v = validatePointsProgram({
      pointsPerDollar: 10,
      catalog: [
        {
          pointsCost: 700,
          reward: {
            kind: "FIXED_DISCOUNT",
            name: "$1 off",
            discountCents: 100,
          },
        },
      ],
    });
    expect(
      warningIssues(v).some((i) => i.code === "discount_no_leverage"),
    ).toBe(true);
  });

  it("warns when a cost is an estimate rather than the owner's figure", () => {
    const v = validatePointsProgram({
      pointsPerDollar: 10,
      catalog: [
        { pointsCost: 700, reward: { ...freeItem, unitCostCents: null } },
      ],
    });
    expect(warningIssues(v).some((i) => i.code === "cost_estimated")).toBe(
      true,
    );
  });

  it("mirrors the DB thresholds", () => {
    expect(POINTS_BOUNDS.blockCostRateBps).toBe(1000);
    expect(POINTS_BOUNDS.warnCostRateBps).toBe(500);
    expect(COMPLETION_RATE_HIGH_BPS).toBe(7000);
  });
});

describe("provenance labels", () => {
  it("names each source distinctly", () => {
    expect(sourceLabel("provided")).toBe("your figure");
    expect(sourceLabel("estimated")).toBe("estimated");
    expect(sourceLabel("skipped")).toBe("skipped");
    expect(sourceLabel("unavailable")).toBe("not available yet");
  });
});

describe("formatters", () => {
  it("formats cents, basis points, ×100 integers and points", () => {
    expect(formatCents(305)).toBe("$3.05");
    expect(formatBps(500)).toBe("5%");
    expect(formatX100(433)).toBe("4.33");
    expect(formatPoints(1250)).toBe("1,250 pts");
  });
});
