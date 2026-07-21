import { describe, expect, it } from "vitest";

import {
  PLATFORM_BOUNDS,
  estimateRewardCostCents,
  formatBps,
  formatCents,
  rateBps,
  stampProgramEconomics,
  validateStampProgram,
  type StampProgramConfig,
} from "@/features/loyalty/engine";

const baseConfig: StampProgramConfig = {
  stampsRequired: 6,
  qualifyingMinCents: 800,
  stampPeriodMinutes: 240,
  rewardName: "Free drink",
  rewardRetailValueCents: 300,
  rewardEstCostCents: 80,
};

describe("rateBps", () => {
  it("computes integer basis points with floor semantics", () => {
    // 80 / 4800 = 1.666...% → 166 bps (floored)
    expect(rateBps(80, 4800)).toBe(166);
  });

  it("returns 0 for a non-positive whole", () => {
    expect(rateBps(80, 0)).toBe(0);
    expect(rateBps(80, -100)).toBe(0);
  });

  it("throws on non-integer inputs (no floating-point money)", () => {
    expect(() => rateBps(80.5, 4800)).toThrow();
    expect(() => rateBps(80, 4800.1)).toThrow();
  });

  it("only ever returns integers", () => {
    for (const [part, whole] of [
      [1, 3],
      [7, 999],
      [123, 4567],
    ]) {
      expect(Number.isInteger(rateBps(part, whole))).toBe(true);
    }
  });
});

describe("estimateRewardCostCents", () => {
  it("uses the entered cost when provided", () => {
    expect(estimateRewardCostCents(300, 80)).toEqual({
      costCents: 80,
      estimated: false,
    });
  });

  it("falls back to a labeled 30%-of-retail estimate", () => {
    expect(estimateRewardCostCents(300, null)).toEqual({
      costCents: 90,
      estimated: true,
    });
  });

  it("floors the estimate to whole cents", () => {
    // 350 * 30 / 100 = 105 exactly; 349 * 30 / 100 = 104.7 → 104
    expect(estimateRewardCostCents(349, null).costCents).toBe(104);
  });
});

describe("stampProgramEconomics", () => {
  const economics = stampProgramEconomics(baseConfig, {
    typicalOrderCents: 1200,
    estimatedMonthlyRegulars: 30,
    estimatedVisitsPerRegularPerMonth: 4,
  });

  it("derives visits from stamp count with first-visit bonus", () => {
    expect(economics.visitsToFirstReward).toBe(5); // 6 - 1 bonus
    expect(economics.visitsPerRewardAfter).toBe(6);
  });

  it("computes qualifying spend from typical order × stamps", () => {
    expect(economics.qualifyingSpendCents).toBe(7200); // 6 × 1200
    expect(economics.firstCardSpendCents).toBe(6000); // 5 × 1200
  });

  it("keeps perceived value well above vendor cost for a high-margin item", () => {
    // perceived: 300 / 7200 ≈ 4.16% ; cost: 80 / 7200 ≈ 1.11%
    expect(economics.perceivedRateBps).toBeGreaterThan(economics.costRateBps);
    expect(economics.costRateBps).toBeLessThan(200);
  });

  it("marks estimated cost and falls back to the qualifying min when order is unknown", () => {
    const est = stampProgramEconomics(
      { ...baseConfig, rewardEstCostCents: null },
      {
        typicalOrderCents: null,
        estimatedMonthlyRegulars: 30,
        estimatedVisitsPerRegularPerMonth: 4,
      },
    );
    expect(est.costIsEstimated).toBe(true);
    expect(est.qualifyingSpendCents).toBe(6 * baseConfig.qualifyingMinCents);
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
});

describe("validateStampProgram", () => {
  it("accepts a sane config", () => {
    expect(validateStampProgram(baseConfig).errors).toHaveLength(0);
  });

  it("rejects stamp counts outside platform bounds", () => {
    expect(
      validateStampProgram({ ...baseConfig, stampsRequired: 3 }).errors.length,
    ).toBeGreaterThan(0);
    expect(
      validateStampProgram({ ...baseConfig, stampsRequired: 11 }).errors.length,
    ).toBeGreaterThan(0);
  });

  it("rejects a qualifying minimum outside $1–$100", () => {
    expect(
      validateStampProgram({ ...baseConfig, qualifyingMinCents: 50 }).errors
        .length,
    ).toBeGreaterThan(0);
    expect(
      validateStampProgram({ ...baseConfig, qualifyingMinCents: 20000 }).errors
        .length,
    ).toBeGreaterThan(0);
  });

  it("blocks publishing when reward cost exceeds 10% of conservative spend", () => {
    // 6 × $1 = $6 qualifying; reward cost $1 = ~16.7% → over the 10% cap
    const result = validateStampProgram({
      ...baseConfig,
      qualifyingMinCents: 100,
      rewardRetailValueCents: 300,
      rewardEstCostCents: 100,
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toMatch(/10%/);
  });

  it("warns (but does not block) between 5% and 10% cost rate", () => {
    // 6 × $2 = $12 qualifying; cost $0.80 ≈ 6.7% → warn, no error
    const result = validateStampProgram({
      ...baseConfig,
      qualifyingMinCents: 200,
      rewardEstCostCents: 80,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("warns when the vendor omitted real cost data", () => {
    const result = validateStampProgram({
      ...baseConfig,
      rewardEstCostCents: null,
    });
    expect(result.warnings.join(" ")).toMatch(/estimate/i);
  });

  it("mirrors the DB block threshold constant", () => {
    expect(PLATFORM_BOUNDS.blockCostRateBps).toBe(1000);
    expect(PLATFORM_BOUNDS.warnCostRateBps).toBe(500);
  });
});

describe("formatters", () => {
  it("formats cents as dollars with two decimals", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(305)).toBe("$3.05");
    expect(formatCents(-150)).toBe("-$1.50");
  });

  it("formats basis points as a percentage", () => {
    expect(formatBps(166)).toBe("1.6%");
    expect(formatBps(500)).toBe("5%");
  });
});
