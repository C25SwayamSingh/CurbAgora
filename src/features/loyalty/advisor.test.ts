import { describe, expect, it } from "vitest";

import { PLATFORM_BOUNDS } from "@/features/loyalty/engine";
import {
  candidateStampCounts,
  existingSystemAdvice,
  recommendPrograms,
  suggestQualifyingMinCents,
  type ConsultationAnswers,
} from "@/features/loyalty/advisor";

const baseAnswers: ConsultationAnswers = {
  typicalOrderCents: 1200,
  visitFrequency: "weekly",
  goal: "repeat_visits",
  rewards: [{ name: "Free drink", retailCents: 300, costCents: 80 }],
  monthlyBudgetCents: 20000,
  estimatedMonthlyRegulars: 30,
  existingSystem: "none",
};

describe("suggestQualifyingMinCents", () => {
  it("defaults to $8 when the typical order is unknown", () => {
    expect(suggestQualifyingMinCents(null)).toBe(800);
  });

  it("rounds 70% of the order to the nearest 50 cents", () => {
    // 1200 * 0.7 = 840 → nearest 50 = 850
    expect(suggestQualifyingMinCents(1200)).toBe(850);
  });

  it("clamps to platform bounds", () => {
    expect(suggestQualifyingMinCents(50)).toBe(
      PLATFORM_BOUNDS.minQualifyingCents,
    );
    expect(suggestQualifyingMinCents(1_000_000)).toBe(
      PLATFORM_BOUNDS.maxQualifyingCents,
    );
  });
});

describe("candidateStampCounts", () => {
  it("stays within platform stamp bounds for every cadence", () => {
    for (const freq of ["weekly", "biweekly", "monthly", "unsure"] as const) {
      for (const count of candidateStampCounts(freq)) {
        expect(count).toBeGreaterThanOrEqual(PLATFORM_BOUNDS.minStamps);
        expect(count).toBeLessThanOrEqual(PLATFORM_BOUNDS.maxStamps);
      }
    }
  });
});

describe("recommendPrograms", () => {
  it("returns at most three recommendations, ranked by fit descending", () => {
    const recs = recommendPrograms(baseAnswers);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].fitScore).toBeGreaterThanOrEqual(recs[i].fitScore);
    }
  });

  it("never proposes a program that fails validation (cost cap)", () => {
    // Expensive reward relative to a low qualifying min → all candidates
    // should be filtered out rather than recommending an over-cost program.
    const recs = recommendPrograms({
      ...baseAnswers,
      typicalOrderCents: 100,
      rewards: [{ name: "Whole meal", retailCents: 2000, costCents: 1500 }],
    });
    expect(recs).toHaveLength(0);
  });

  it("defaults to a Free drink reward when none is supplied", () => {
    const recs = recommendPrograms({ ...baseAnswers, rewards: [] });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].config.rewardName).toBe("Free drink");
  });

  it("flags estimated-cost programs as a risk", () => {
    const recs = recommendPrograms({
      ...baseAnswers,
      rewards: [{ name: "Free drink", retailCents: 300, costCents: null }],
    });
    expect(recs[0].risks.join(" ")).toMatch(/estimate/i);
  });

  it("carries integer-cents config into each recommendation", () => {
    for (const rec of recommendPrograms(baseAnswers)) {
      expect(Number.isInteger(rec.config.stampsRequired)).toBe(true);
      expect(Number.isInteger(rec.config.qualifyingMinCents)).toBe(true);
      expect(Number.isInteger(rec.config.rewardRetailValueCents)).toBe(true);
    }
  });

  it("respects a tight monthly budget in scoring", () => {
    const generous = recommendPrograms({
      ...baseAnswers,
      monthlyBudgetCents: 100000,
    })[0];
    const tight = recommendPrograms({
      ...baseAnswers,
      monthlyBudgetCents: 100,
    })[0];
    // A $1 budget can't fit; the same top program should score lower.
    expect(tight.fitScore).toBeLessThan(generous.fitScore);
  });
});

describe("existingSystemAdvice", () => {
  it("returns guidance for each non-none system and null for none", () => {
    expect(existingSystemAdvice("none")).toBeNull();
    expect(existingSystemAdvice("paper")).toMatch(/paper/i);
    expect(existingSystemAdvice("square_or_pos")).toBeTruthy();
    expect(existingSystemAdvice("other")).toBeTruthy();
  });
});
