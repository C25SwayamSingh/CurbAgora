import { describe, expect, it } from "vitest";

import {
  createOrganizationSchema,
  suggestSlug,
} from "@/features/organizations/schemas";

describe("createOrganizationSchema", () => {
  const valid = {
    legalName: "Maria's Taco Cart LLC",
    displayName: "Maria's Taco Cart",
    slug: "marias-taco-cart",
  };

  it("accepts a valid organization", () => {
    expect(createOrganizationSchema.safeParse(valid).success).toBe(true);
  });

  it("lowercases slugs before validating", () => {
    const result = createOrganizationSchema.safeParse({
      ...valid,
      slug: "MARIAS-taco-CART",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe("marias-taco-cart");
    }
  });

  it("rejects malformed slugs", () => {
    for (const slug of [
      "a",
      "-leading",
      "trailing-",
      "spaces here",
      "under_score",
      "emoji-🌮",
      "x".repeat(49),
    ]) {
      expect(
        createOrganizationSchema.safeParse({ ...valid, slug }).success,
        slug,
      ).toBe(false);
    }
  });

  it("rejects names outside length bounds", () => {
    expect(
      createOrganizationSchema.safeParse({ ...valid, legalName: "x" }).success,
    ).toBe(false);
    expect(
      createOrganizationSchema.safeParse({
        ...valid,
        displayName: "x".repeat(121),
      }).success,
    ).toBe(false);
  });
});

describe("suggestSlug", () => {
  it("derives URL-safe slugs from names", () => {
    expect(suggestSlug("Maria's Taco Cart")).toBe("maria-s-taco-cart");
    expect(suggestSlug("  Crêpes & Co.  ")).toBe("crepes-co");
    expect(suggestSlug("!!!")).toBe("");
  });
});
