import { describe, expect, it } from "vitest";

import {
  CHECKOUT_PAYLOAD_PREFIX,
  formatCheckoutPayload,
  isValidNumericCode,
  normalizeNumericInput,
  parseCheckoutPayload,
  parseSubtotalToCents,
  previewPoints,
} from "@/features/loyalty/checkout-code";
import {
  generateCheckoutSecrets,
  hashCheckoutToken,
} from "@/features/loyalty/checkout-token";

const TOKEN = "a".repeat(43);

describe("checkout payload", () => {
  it("round-trips a token through format and parse", () => {
    expect(parseCheckoutPayload(formatCheckoutPayload(TOKEN))).toBe(TOKEN);
  });

  it("rejects a QR that isn't a CurbAgora checkout code", () => {
    expect(parseCheckoutPayload("https://example.com/menu")).toBeNull();
    expect(parseCheckoutPayload("WIFI:S:CartGuest;T:WPA;;")).toBeNull();
    expect(parseCheckoutPayload("")).toBeNull();
  });

  it("rejects a right-prefixed payload carrying a malformed token", () => {
    expect(parseCheckoutPayload(`${CHECKOUT_PAYLOAD_PREFIX}short`)).toBeNull();
    expect(
      parseCheckoutPayload(`${CHECKOUT_PAYLOAD_PREFIX}${"a".repeat(44)}`),
    ).toBeNull();
    // '+' and '/' are base64, not base64url — a decoder bug, not a valid code.
    expect(
      parseCheckoutPayload(`${CHECKOUT_PAYLOAD_PREFIX}${"a".repeat(42)}+`),
    ).toBeNull();
  });

  it("tolerates the whitespace a decoder may hand back", () => {
    expect(parseCheckoutPayload(`  ${formatCheckoutPayload(TOKEN)}\n`)).toBe(
      TOKEN,
    );
  });

  it("carries no customer information", () => {
    const payload = formatCheckoutPayload(TOKEN);
    expect(payload).toBe(`${CHECKOUT_PAYLOAD_PREFIX}${TOKEN}`);
    // Nothing beyond scheme + opaque token: no id, email, or balance.
    expect(payload.split(":")).toHaveLength(3);
  });
});

describe("token generation", () => {
  it("mints a 43-character base64url token that parses as a payload", () => {
    const { token } = generateCheckoutSecrets();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parseCheckoutPayload(formatCheckoutPayload(token))).toBe(token);
  });

  it("never repeats a token across draws", () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => generateCheckoutSecrets().token),
    );
    expect(tokens.size).toBe(200);
  });

  it("stores only a digest — the token is not recoverable from it", () => {
    const { token, tokenDigest } = generateCheckoutSecrets();
    expect(tokenDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenDigest).not.toContain(token);
    expect(hashCheckoutToken(token)).toBe(tokenDigest);
  });

  it("offers distinct 4-digit candidates so a collision has alternatives", () => {
    const { codeCandidates } = generateCheckoutSecrets();
    expect(codeCandidates).toHaveLength(12);
    expect(new Set(codeCandidates).size).toBe(12);
    for (const candidate of codeCandidates) {
      expect(candidate).toMatch(/^[0-9]{4}$/);
    }
  });

  it("keeps leading zeros so every code is spoken as four digits", () => {
    const padded = Array.from({ length: 400 }, () => generateCheckoutSecrets())
      .flatMap((s) => s.codeCandidates)
      .filter((c) => c.startsWith("0"));
    expect(padded.length).toBeGreaterThan(0);
    for (const code of padded) expect(code).toHaveLength(4);
  });
});

describe("numeric code entry", () => {
  it("accepts exactly four digits", () => {
    expect(isValidNumericCode("4827")).toBe(true);
    expect(isValidNumericCode("0000")).toBe(true);
    expect(isValidNumericCode("482")).toBe(false);
    expect(isValidNumericCode("48271")).toBe(false);
    expect(isValidNumericCode("48a7")).toBe(false);
  });

  it("strips anything a numeric keypad shouldn't produce", () => {
    expect(normalizeNumericInput("4-8 2a7")).toBe("4827");
    expect(normalizeNumericInput("482799")).toBe("4827");
    expect(normalizeNumericInput("")).toBe("");
  });
});

describe("points preview", () => {
  it("matches the server formula exactly", () => {
    // 2340 cents at 10 pts/$ -> 234, the documented worked example.
    expect(previewPoints(2340, 10)).toBe(234);
  });

  it("floors partial points rather than rounding up", () => {
    expect(previewPoints(199, 1)).toBe(1);
    expect(previewPoints(99, 1)).toBe(0);
  });

  it("returns zero for a non-positive or non-integer amount", () => {
    expect(previewPoints(0, 10)).toBe(0);
    expect(previewPoints(-500, 10)).toBe(0);
    expect(previewPoints(12.5, 10)).toBe(0);
  });
});

describe("subtotal parsing", () => {
  it("parses plain dollars and cents into integer cents", () => {
    expect(parseSubtotalToCents("12.50")).toBe(1250);
    expect(parseSubtotalToCents("23.40")).toBe(2340);
    expect(parseSubtotalToCents("7")).toBe(700);
    expect(parseSubtotalToCents("7.5")).toBe(750);
  });

  it("tolerates a dollar sign, commas, and surrounding space", () => {
    expect(parseSubtotalToCents(" $1,234.56 ")).toBe(123456);
  });

  it("refuses anything that isn't plainly an amount", () => {
    for (const bad of ["", "abc", "12.345", "-5", "1.2.3", "12,5.0.1"]) {
      expect(parseSubtotalToCents(bad)).toBeNull();
    }
  });

  it("refuses zero — a free order cannot earn points", () => {
    expect(parseSubtotalToCents("0")).toBeNull();
    expect(parseSubtotalToCents("0.00")).toBeNull();
  });
});
