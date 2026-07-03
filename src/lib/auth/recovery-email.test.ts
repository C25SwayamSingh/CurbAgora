import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const TEMPLATE_PATH = join(process.cwd(), "supabase/templates/recovery.html");

describe("recovery email template", () => {
  const template = readFileSync(TEMPLATE_PATH, "utf8");

  it("does not use target=_blank", () => {
    expect(template).not.toMatch(/target\s*=\s*["']_blank["']/i);
  });

  it("does not call window.open", () => {
    expect(template).not.toMatch(/window\.open/i);
  });

  it("contains exactly one recovery interstitial link", () => {
    const hrefs = template.match(/href="[^"]+"/g) ?? [];
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toContain("/auth/recovery");
    expect(hrefs[0]).toContain("token_hash=");
    expect(hrefs[0]).toContain("type=recovery");
  });

  it("routes through the interstitial page instead of direct verify URLs", () => {
    expect(template).not.toContain("/auth/v1/verify");
    expect(template).not.toContain("/auth/confirm");
  });
});
