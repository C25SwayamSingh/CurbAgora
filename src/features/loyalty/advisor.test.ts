import { describe, expect, it } from "vitest";

import { POINTS_BOUNDS, tracked } from "@/features/loyalty/engine";
import {
  DEFAULT_POINTS_PER_DOLLAR,
  VISIT_CADENCE_X100,
  describeEarnPace,
  existingSystemGuidance,
  recommendPrograms,
  type ConsultationAnswers,
  type VisitCadence,
} from "@/features/loyalty/advisor";

const horchata = {
  kind: "FREE_ITEM" as const,
  name: "Horchata",
  retailCents: 350,
  unitCostCents: 90,
};
const taco = {
  kind: "FREE_ITEM" as const,
  name: "Taco",
  retailCents: 500,
  unitCostCents: 150,
};
const plate = {
  kind: "FREE_ITEM" as const,
  name: "Plate",
  retailCents: 1000,
  unitCostCents: 300,
};

const baseAnswers: ConsultationAnswers = {
  typicalOrderCents: tracked(1200, "provided"),
  cadence: "weekly",
  cadenceSource: "provided",
  goal: "repeat_visits",
  rewards: [horchata],
  monthlyBudgetCents: tracked(20000, "provided"),
  regularsPerMonth: tracked(30, "provided"),
  existingSystem: "none",
};

describe("points scale", () => {
  it("uses one consistent scale across every recommendation", () => {
    const { recommendations, pointsPerDollar } = recommendPrograms({
      ...baseAnswers,
      rewards: [horchata, taco, plate],
    });
    expect(pointsPerDollar).toBe(DEFAULT_POINTS_PER_DOLLAR);
    for (const r of recommendations) {
      expect(r.config.pointsPerDollar).toBe(DEFAULT_POINTS_PER_DOLLAR);
    }
  });

  it("maps every cadence to an integer visits-per-week ×100", () => {
    for (const c of Object.keys(VISIT_CADENCE_X100) as VisitCadence[]) {
      expect(Number.isInteger(VISIT_CADENCE_X100[c])).toBe(true);
    }
    expect(VISIT_CADENCE_X100.weekly).toBe(100);
    expect(VISIT_CADENCE_X100.biweekly).toBe(50);
  });
});

describe("reward pricing", () => {
  it("prices a reward so its cost stays within the comfort line", () => {
    const rec = recommendPrograms(baseAnswers).recommendations[0];
    expect(rec.economics.entry.costRateBps).toBeLessThanOrEqual(
      POINTS_BOUNDS.warnCostRateBps,
    );
  });

  it("keeps perceived value above vendor cost for a free item", () => {
    const e = recommendPrograms(baseAnswers).recommendations[0].economics.entry;
    expect(e.perceivedRateBps).toBeGreaterThan(e.costRateBps);
  });

  it("prices a more expensive reward at more points", () => {
    const cheap = recommendPrograms({ ...baseAnswers, rewards: [horchata] })
      .recommendations[0];
    const dear = recommendPrograms({ ...baseAnswers, rewards: [taco] })
      .recommendations[0];
    expect(dear.tiers[0].pointsCost).toBeGreaterThan(cheap.tiers[0].pointsCost);
  });

  it("rounds points costs to a clean multiple of 50", () => {
    for (const r of recommendPrograms({
      ...baseAnswers,
      rewards: [horchata, taco, plate],
    }).recommendations) {
      for (const t of r.tiers) {
        expect(t.pointsCost % 50).toBe(0);
      }
    }
  });

  it("charges a discount more points than an equal-value free item", () => {
    const item = recommendPrograms({ ...baseAnswers, rewards: [horchata] })
      .recommendations[0];
    const disc = recommendPrograms({
      ...baseAnswers,
      rewards: [
        { kind: "FIXED_DISCOUNT", name: "$3.50 off", discountCents: 350 },
      ],
    }).recommendations[0];
    // A discount costs full face value, so it must sit behind more spend.
    expect(disc.tiers[0].pointsCost).toBeGreaterThan(item.tiers[0].pointsCost);
  });

  it("excludes a reward no tier price can justify, with arithmetic", () => {
    const { excluded } = recommendPrograms({
      ...baseAnswers,
      rewards: [
        { kind: "FIXED_DISCOUNT", name: "$25 off", discountCents: 2500 },
      ],
    });
    const blocked = excluded.find((e) => e.severity === "block");
    expect(blocked?.reason).toMatch(/beyond what any reward tier/i);
    expect(blocked?.calculation).toBeTruthy();
    expect(blocked?.remedy).toBeTruthy();
  });

  it("excludes a program whose cheapest reward is out of reach", () => {
    // A $10 plate alone prices past the entry-tier reach cap.
    const { recommendations, excluded } = recommendPrograms({
      ...baseAnswers,
      rewards: [plate],
    });
    expect(recommendations).toHaveLength(0);
    const blocked = excluded.find((e) => e.severity === "block");
    expect(blocked?.reason).toMatch(/too far for a first reward/i);
    expect(blocked?.remedy).toMatch(/cheaper reward/i);
  });

  it("accepts that same premium reward as the top of a ladder", () => {
    const ladder = recommendPrograms({
      ...baseAnswers,
      rewards: [horchata, plate],
    }).recommendations.find((r) => r.shape === "ladder");
    expect(ladder).toBeDefined();
    expect(ladder!.tiers.at(-1)!.reward.name).toBe("Plate");
  });
});

describe("catalog shapes", () => {
  it("offers only a single-reward program when one reward is given", () => {
    const { recommendations } = recommendPrograms(baseAnswers);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].shape).toBe("single");
  });

  it("adds a two-tier ladder when two rewards are given", () => {
    const { recommendations } = recommendPrograms({
      ...baseAnswers,
      rewards: [horchata, plate],
    });
    expect(recommendations.map((r) => r.shape).sort()).toEqual(
      ["ladder", "single"].sort(),
    );
  });

  it("adds a full catalog when three or more rewards are given", () => {
    const shapes = recommendPrograms({
      ...baseAnswers,
      rewards: [horchata, taco, plate],
    }).recommendations.map((r) => r.shape);
    expect(shapes).toContain("full");
    expect(new Set(shapes).size).toBe(shapes.length); // genuinely distinct
  });

  it("ranks by fit descending and returns at most three", () => {
    const { recommendations } = recommendPrograms({
      ...baseAnswers,
      rewards: [horchata, taco, plate],
    });
    expect(recommendations.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < recommendations.length; i++) {
      expect(recommendations[i - 1].fitScore).toBeGreaterThanOrEqual(
        recommendations[i].fitScore,
      );
    }
  });

  it("orders ladder tiers cheapest-first so progress reads correctly", () => {
    const ladder = recommendPrograms({
      ...baseAnswers,
      rewards: [plate, horchata],
    }).recommendations.find((r) => r.shape === "ladder");
    expect(ladder).toBeDefined();
    expect(ladder!.tiers[0].pointsCost).toBeLessThan(
      ladder!.tiers[1].pointsCost,
    );
  });
});

describe("transparency", () => {
  it("exposes an inspectable score breakdown for every option", () => {
    for (const r of recommendPrograms(baseAnswers).recommendations) {
      expect(r.scoreBreakdown.length).toBeGreaterThan(1);
      expect(r.scoreBreakdown[0]).toMatch(/Base/);
    }
  });

  it("summarizes the inputs used, with provenance", () => {
    const { inputSummary } = recommendPrograms(baseAnswers);
    const labels = inputSummary.map((r) => r.label);
    expect(labels).toContain("Points per dollar");
    expect(labels).toContain("Typical order total");
    expect(labels).toContain("Regulars per month");
    expect(inputSummary.every((r) => r.source.length > 0)).toBe(true);
  });

  it("marks skipped inputs as skipped rather than inventing a value", () => {
    const { inputSummary } = recommendPrograms({
      ...baseAnswers,
      monthlyBudgetCents: tracked(null, "skipped"),
    });
    const budget = inputSummary.find(
      (r) => r.label === "Monthly reward budget",
    );
    expect(budget?.source).toBe("skipped");
    expect(budget?.value).toMatch(/not given/i);
  });

  it("surfaces the weekly→monthly conversion in assumptions", () => {
    const r = recommendPrograms(baseAnswers).recommendations[0];
    expect(r.assumptions.join(" ")).toMatch(/4\.33 weeks per month/);
  });

  it("states the earning rule in points per dollar", () => {
    const r = recommendPrograms(baseAnswers).recommendations[0];
    expect(r.earnRule).toMatch(/10 points per \$1/);
    expect(r.earnRule).toMatch(/staff/i);
  });

  it("blocks an option costing several times the stated budget", () => {
    const { excluded } = recommendPrograms({
      ...baseAnswers,
      monthlyBudgetCents: tracked(100, "provided"), // $1/month
    });
    const blocked = excluded.filter((e) => e.severity === "block");
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].reason).toMatch(/more than the \$1\.00 you said/i);
    // The arithmetic, in terms an owner can check against their own cart.
    expect(blocked[0].calculation).toMatch(/regulars would earn about/i);
    expect(blocked[0].remedy).toMatch(/raise the budget/i);
  });

  it("costs a reward priced beyond one month of earning, rather than zero", () => {
    // Regression. A $12 order once a week at 10 pts/$ earns ~519 points a
    // month; a 600-point reward is therefore earned every ~5 weeks. Integer
    // division floored that to "0 rewards per month", so every projection read
    // $0.00 and the budget guard below could never fire.
    const { recommendations } = recommendPrograms({
      ...baseAnswers,
      monthlyBudgetCents: tracked(null, "skipped"),
      rewards: [{ kind: "FIXED_DISCOUNT", name: "$3 off", discountCents: 300 }],
    });
    const rec = recommendations[0];
    expect(rec).toBeDefined();
    expect(rec.economics.entry.pointsCost).toBeGreaterThan(
      rec.economics.monthlyPointsPerRegular,
    );
    expect(rec.economics.monthlyCostWorstCaseCents).toBeGreaterThan(0);
    expect(rec.economics.monthlyCostHighCents).toBeGreaterThan(0);
  });

  it("reports how long a regular takes to reach the first reward", () => {
    expect(describeEarnPace(8650)).toMatch(/5 weeks/);
    expect(describeEarnPace(43300)).toMatch(/week/);
    expect(describeEarnPace(0)).toMatch(/never/i);
  });

  it("returns no recommendations when nothing can be priced, and says why", () => {
    const { recommendations, excluded } = recommendPrograms({
      ...baseAnswers,
      rewards: [
        { kind: "FIXED_DISCOUNT", name: "$40 off", discountCents: 4000 },
      ],
    });
    expect(recommendations).toHaveLength(0);
    expect(excluded.length).toBeGreaterThan(0);
  });

  it("defaults to a free drink when no reward is supplied", () => {
    const r = recommendPrograms({ ...baseAnswers, rewards: [] })
      .recommendations[0];
    expect(r.tiers[0].reward.name).toBe("Free drink");
  });
});

describe("existingSystemGuidance", () => {
  it("returns null when there is no current system", () => {
    expect(existingSystemGuidance("none")).toBeNull();
  });

  it("gives paper cards a titled migration plan with ordered steps", () => {
    const g = existingSystemGuidance("paper");
    expect(g?.title).toBe("Moving from paper punch cards");
    expect(g?.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("warns POS users about double-rewarding one purchase", () => {
    const g = existingSystemGuidance("square_or_pos");
    expect(g?.steps.join(" ")).toMatch(/should not earn in both/i);
  });
});
