/**
 * Shared vocabulary for checkout identification — imported by the customer's
 * QR renderer, the staff scanner, and the server actions, so all three agree
 * on exactly what a CurbAgora checkout code looks like.
 *
 * Everything here is pure and isomorphic. Nothing in this file can identify a
 * person: the token is opaque and carries no customer data, by design.
 */

/**
 * Scheme prefix on the QR payload. Its only job is to let the scanner reject
 * an unrelated QR (a Wi-Fi code, a URL on the next stall's menu) instantly and
 * locally, instead of spending a server round trip to learn it was junk. The
 * version segment leaves room to change the token format later without
 * silently mis-reading old printed material.
 */
export const CHECKOUT_PAYLOAD_PREFIX = "curbagora:c1:";

/** 32 random bytes, base64url-encoded — 43 characters, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NUMERIC_CODE_PATTERN = /^[0-9]{4}$/;

export function formatCheckoutPayload(token: string): string {
  return `${CHECKOUT_PAYLOAD_PREFIX}${token}`;
}

/**
 * Pull the token out of a scanned payload, or null if this QR is not a
 * CurbAgora checkout code. Returning null (rather than throwing) keeps the
 * scanner loop simple: it just keeps looking at frames until a real one
 * arrives.
 */
export function parseCheckoutPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(CHECKOUT_PAYLOAD_PREFIX)) return null;
  const token = trimmed.slice(CHECKOUT_PAYLOAD_PREFIX.length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

export function isValidNumericCode(value: string): boolean {
  return NUMERIC_CODE_PATTERN.test(value.trim());
}

/** Strip everything a numeric keypad shouldn't produce, then cap at 4. */
export function normalizeNumericInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

/**
 * Points a purchase will earn. Deliberately mirrors the SQL exactly —
 * `(cents * pointsPerDollar) / 100` under integer division — so the preview
 * staff see before confirming is the number the ledger will record. The server
 * remains the authority; this is a display convenience, never an input.
 */
export function previewPoints(
  eligibleSubtotalCents: number,
  pointsPerDollar: number,
): number {
  if (!Number.isInteger(eligibleSubtotalCents) || eligibleSubtotalCents <= 0) {
    return 0;
  }
  return Math.floor((eligibleSubtotalCents * pointsPerDollar) / 100);
}

/**
 * Parse a staff-typed money amount into integer cents. Rejects anything that
 * isn't plainly a number of dollars so a typo can never become a silent zero.
 */
export function parseSubtotalToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
