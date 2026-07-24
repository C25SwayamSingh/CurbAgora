import { describe, expect, it } from "vitest";

import {
  CATALOG_BENCHMARKS,
  CHAIN_BENCHMARKS,
  DEFAULT_STANCE,
  RETURN_BANDS,
  bandFor,
  placeAgainstChains,
} from "@/features/loyalty/benchmarks";

describe("chain benchmarks", () => {
  it("cites a source and a review date for every figure", () => {
    for (const b of [...CHAIN_BENCHMARKS, ...CATALOG_BENCHMARKS]) {
      expect(b.source).toMatch(/^https:\/\//);
      // These programs change without notice; an undated benchmark is a
      // claim a vendor cannot check.
      expect(b.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.structure.length).toBeGreaterThan(10);
    }
  });

  it("shows the arithmetic behind each percentage", () => {
    for (const b of CHAIN_BENCHMARKS) {
      expect(b.calculation).toMatch(/÷|\//);
      expect(b.calculation).toMatch(/%/);
    }
  });

  it("spans the observed 3.3%–7.5% range", () => {
    const rates = CHAIN_BENCHMARKS.map((b) => b.returnBps);
    expect(Math.min(...rates)).toBe(330);
    expect(Math.max(...rates)).toBe(750);
  });

  it("omits a percentage for catalog programs, which have no single rate", () => {
    for (const b of CATALOG_BENCHMARKS) {
      expect(b).not.toHaveProperty("returnBps");
    }
  });
});

describe("return bands", () => {
  it("orders conservative below balanced below competitive", () => {
    const [c, b, k] = RETURN_BANDS;
    expect(c.highBps).toBeLessThanOrEqual(b.highBps);
    expect(b.highBps).toBeLessThanOrEqual(k.highBps);
  });

  it("stays inside the range the chains actually occupy", () => {
    const lowest = Math.min(...CHAIN_BENCHMARKS.map((x) => x.returnBps));
    const highest = Math.max(...CHAIN_BENCHMARKS.map((x) => x.returnBps));
    for (const band of RETURN_BANDS) {
      expect(band.lowBps).toBeGreaterThanOrEqual(lowest - 50);
      expect(band.highBps).toBeLessThanOrEqual(highest + 50);
    }
  });

  it("defaults to balanced, centred near the 5% cluster", () => {
    const band = bandFor(DEFAULT_STANCE);
    expect(band.stance).toBe("balanced");
    expect(band.lowBps).toBeLessThanOrEqual(500);
    expect(band.highBps).toBeGreaterThanOrEqual(500);
  });
});

describe("placeAgainstChains", () => {
  it("names the nearest chains a rate falls between", () => {
    // 6% sits between Subway (5%) and McDonald's (7.5%).
    const text = placeAgainstChains(600);
    expect(text).toMatch(/Subway/);
    expect(text).toMatch(/McDonald/);
  });

  it("says plainly when a program is leaner than all of them", () => {
    expect(placeAgainstChains(100)).toMatch(/Leaner than every chain/i);
  });

  it("says plainly when a program is more generous than all of them", () => {
    expect(placeAgainstChains(1200)).toMatch(/More generous than every chain/i);
  });

  it("recognises a rate matching a chain exactly", () => {
    expect(placeAgainstChains(500)).toMatch(/Subway/);
  });
});
