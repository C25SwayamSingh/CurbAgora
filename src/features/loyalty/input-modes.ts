/**
 * Structured numeric input with explicit "I don't know" handling.
 *
 * The previous form stripped non-digits and continued, so typing "idk" was
 * silently identical to leaving the field blank — the owner was never told
 * their answer had been discarded. Every financial question now carries an
 * explicit mode, and free text that isn't a number is a field error rather
 * than a silent null.
 */

import type { ValueSource } from "@/features/loyalty/engine";

export type InputMode = "known" | "estimate" | "skip";

export const INPUT_MODE_LABEL: Record<InputMode, string> = {
  known: "I know this number",
  estimate: "Help me estimate",
  skip: "Skip for now",
};

export type ParsedField =
  | { ok: true; cents: number | null; source: ValueSource }
  | { ok: false; message: string };

/** Strict money parser: digits, at most one decimal point, optional "$"/",". */
export function parseMoneyStrict(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return "invalid";
  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : "invalid";
}

/** Strict positive-integer parser (counts of people, visits, etc.). */
export function parseCountStrict(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : "invalid";
}

/**
 * Resolve one money field given its mode. `estimateCents` is the advisor's
 * conservative fallback, used only in "estimate" mode and always labeled.
 */
export function resolveMoneyField(
  mode: InputMode,
  raw: string,
  estimateCents: number | null,
  fieldLabel: string,
): ParsedField {
  if (mode === "skip") return { ok: true, cents: null, source: "skipped" };
  if (mode === "estimate")
    return { ok: true, cents: estimateCents, source: "estimated" };

  const parsed = parseMoneyStrict(raw);
  if (parsed === "invalid") {
    return {
      ok: false,
      message: `${fieldLabel} must be a number like 12 or 12.50. To leave it out, choose “${INPUT_MODE_LABEL.skip}”.`,
    };
  }
  if (parsed === null) {
    return {
      ok: false,
      message: `Enter ${fieldLabel.toLowerCase()}, or choose “${INPUT_MODE_LABEL.skip}”.`,
    };
  }
  return { ok: true, cents: parsed, source: "provided" };
}

/** Resolve one count field given its mode. */
export function resolveCountField(
  mode: InputMode,
  raw: string,
  estimate: number,
  fieldLabel: string,
):
  | { ok: true; count: number; source: ValueSource }
  | { ok: false; message: string } {
  if (mode === "skip")
    return { ok: true, count: estimate, source: "estimated" };
  if (mode === "estimate")
    return { ok: true, count: estimate, source: "estimated" };

  const parsed = parseCountStrict(raw);
  if (parsed === "invalid") {
    return {
      ok: false,
      message: `${fieldLabel} must be a whole number. To leave it out, choose “${INPUT_MODE_LABEL.skip}”.`,
    };
  }
  if (parsed === null) {
    return {
      ok: false,
      message: `Enter ${fieldLabel.toLowerCase()}, or choose “${INPUT_MODE_LABEL.skip}”.`,
    };
  }
  return { ok: true, count: parsed, source: "provided" };
}
