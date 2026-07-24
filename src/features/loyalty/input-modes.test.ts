import { describe, expect, it } from "vitest";

import {
  parseCountStrict,
  parseMoneyStrict,
  resolveCountField,
  resolveMoneyField,
} from "@/features/loyalty/input-modes";

describe("parseMoneyStrict", () => {
  it("accepts plain and decorated numbers", () => {
    expect(parseMoneyStrict("12")).toBe(1200);
    expect(parseMoneyStrict("12.50")).toBe(1250);
    expect(parseMoneyStrict("$12.50")).toBe(1250);
    expect(parseMoneyStrict("1,200")).toBe(120000);
    expect(parseMoneyStrict("0.90")).toBe(90);
  });

  it("treats blank as absent, not zero", () => {
    expect(parseMoneyStrict("")).toBeNull();
    expect(parseMoneyStrict("   ")).toBeNull();
  });

  // The original bug: non-numeric text was stripped to "" and silently
  // became "no answer". These must now be rejected outright.
  it.each([
    "idk",
    "unknown",
    "maybe",
    "a few bucks",
    "12 or 13",
    "??",
    "1.2.3",
  ])("rejects junk input %s instead of silently discarding it", (raw) => {
    expect(parseMoneyStrict(raw)).toBe("invalid");
  });

  it("rejects more than two decimal places", () => {
    expect(parseMoneyStrict("12.505")).toBe("invalid");
  });
});

describe("parseCountStrict", () => {
  it("accepts whole numbers only", () => {
    expect(parseCountStrict("30")).toBe(30);
    expect(parseCountStrict("")).toBeNull();
    expect(parseCountStrict("30.5")).toBe("invalid");
    expect(parseCountStrict("idk")).toBe("invalid");
  });
});

describe("resolveMoneyField", () => {
  it("marks a typed value as owner-provided", () => {
    const r = resolveMoneyField("known", "12.50", 900, "Typical order");
    expect(r).toEqual({ ok: true, cents: 1250, source: "provided" });
  });

  it("marks an estimate as estimated, not provided", () => {
    const r = resolveMoneyField("estimate", "", 900, "Typical order");
    expect(r).toEqual({ ok: true, cents: 900, source: "estimated" });
  });

  it("marks a skip as skipped with a null value", () => {
    const r = resolveMoneyField("skip", "", 900, "Typical order");
    expect(r).toEqual({ ok: true, cents: null, source: "skipped" });
  });

  it("returns a field-level explanation for junk text", () => {
    const r = resolveMoneyField("known", "idk", 900, "Monthly reward budget");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/must be a number/i);
      expect(r.message).toMatch(/Skip for now/);
    }
  });

  it("asks for a value rather than assuming blank means skip", () => {
    const r = resolveMoneyField("known", "", 900, "Typical order total");
    expect(r.ok).toBe(false);
  });
});

describe("resolveCountField", () => {
  it("records provenance for each mode", () => {
    expect(resolveCountField("known", "42", 30, "Regulars")).toEqual({
      ok: true,
      count: 42,
      source: "provided",
    });
    expect(resolveCountField("estimate", "", 30, "Regulars")).toEqual({
      ok: true,
      count: 30,
      source: "estimated",
    });
    expect(resolveCountField("skip", "", 30, "Regulars")).toEqual({
      ok: true,
      count: 30,
      source: "estimated",
    });
  });

  it("rejects junk rather than falling back silently", () => {
    const r = resolveCountField("known", "lots", 30, "Regulars per month");
    expect(r.ok).toBe(false);
  });
});
