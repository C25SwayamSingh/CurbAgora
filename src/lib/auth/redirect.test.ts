import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath (open-redirect protection)", () => {
  it("accepts same-origin absolute paths", () => {
    expect(safeNextPath("/vendor")).toBe("/vendor");
    expect(safeNextPath("/account/security?mfa=enrolled")).toBe(
      "/account/security?mfa=enrolled",
    );
  });

  it("falls back when the value is missing", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined, "/onboarding")).toBe("/onboarding");
    expect(safeNextPath("", "/onboarding")).toBe("/onboarding");
  });

  it("rejects absolute URLs to other origins", () => {
    expect(safeNextPath("https://evil.example.com")).toBe("/");
    expect(safeNextPath("http://evil.example.com/vendor")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("mailto:a@b.c")).toBe("/");
  });

  it("rejects protocol-relative and backslash tricks", () => {
    expect(safeNextPath("//evil.example.com")).toBe("/");
    expect(safeNextPath("//evil.example.com/path")).toBe("/");
    expect(safeNextPath("/\\evil.example.com")).toBe("/");
    expect(safeNextPath("\\/evil.example.com")).toBe("/");
    expect(safeNextPath("/..\\..\\etc")).toBe("/");
  });

  it("rejects relative paths that do not start with /", () => {
    expect(safeNextPath("vendor")).toBe("/");
    expect(safeNextPath("../admin")).toBe("/");
  });

  it("strips fragments and normalizes via URL parsing", () => {
    expect(safeNextPath("/vendor#hash")).toBe("/vendor");
  });
});
