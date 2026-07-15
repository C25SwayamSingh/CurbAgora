import { describe, expect, it } from "vitest";

import {
  vendorUnitFormValues,
  vendorUnitSchema,
} from "@/features/vendors/schemas";

const valid = {
  name: "Maria's Taco Cart",
  slug: "marias-taco-cart",
  unitType: "food_truck",
  description: "Tacos and more.",
  cuisineCategories: ["mexican", "american"],
  city: "Austin",
  contactPhone: undefined,
  contactPhoneVisible: false,
  contactEmail: undefined,
  contactEmailVisible: false,
  paymentMethods: ["cash"],
  operatingStatus: "open",
};

describe("vendorUnitSchema", () => {
  it("accepts a valid vendor unit", () => {
    expect(vendorUnitSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a minimal vendor unit with no optional fields", () => {
    const result = vendorUnitSchema.safeParse({
      name: "Ok",
      slug: "ok",
      unitType: "stand",
      description: "",
      cuisineCategories: [],
      city: "Dallas",
      contactPhoneVisible: false,
      contactEmailVisible: false,
      paymentMethods: [],
      operatingStatus: "closed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a name outside length bounds", () => {
    expect(vendorUnitSchema.safeParse({ ...valid, name: "x" }).success).toBe(
      false,
    );
    expect(
      vendorUnitSchema.safeParse({ ...valid, name: "x".repeat(121) }).success,
    ).toBe(false);
  });

  it("lowercases the slug before validating", () => {
    const result = vendorUnitSchema.safeParse({
      ...valid,
      slug: "MARIAS-Taco",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe("marias-taco");
    }
  });

  it("rejects malformed slugs", () => {
    for (const slug of [
      "a",
      "-leading",
      "trailing-",
      "spaces here",
      "under_score",
      "x".repeat(49),
    ]) {
      expect(vendorUnitSchema.safeParse({ ...valid, slug }).success, slug).toBe(
        false,
      );
    }
  });

  it("rejects an unknown vendor type", () => {
    expect(
      vendorUnitSchema.safeParse({ ...valid, unitType: "spaceship" }).success,
    ).toBe(false);
  });

  it("rejects an unknown cuisine category", () => {
    expect(
      vendorUnitSchema.safeParse({
        ...valid,
        cuisineCategories: ["martian"],
      }).success,
    ).toBe(false);
  });

  it("caps cuisine categories at 5", () => {
    expect(
      vendorUnitSchema.safeParse({
        ...valid,
        cuisineCategories: [
          "american",
          "mexican",
          "asian",
          "italian",
          "mediterranean",
          "indian",
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown payment method", () => {
    expect(
      vendorUnitSchema.safeParse({ ...valid, paymentMethods: ["crypto"] })
        .success,
    ).toBe(false);
  });

  it("requires a city", () => {
    expect(vendorUnitSchema.safeParse({ ...valid, city: "" }).success).toBe(
      false,
    );
  });

  it("validates email format when a contact email is provided", () => {
    expect(
      vendorUnitSchema.safeParse({ ...valid, contactEmail: "not-an-email" })
        .success,
    ).toBe(false);
    expect(
      vendorUnitSchema.safeParse({
        ...valid,
        contactEmail: "hello@example.com",
      }).success,
    ).toBe(true);
  });

  it("treats an empty contact phone/email as not provided", () => {
    const result = vendorUnitSchema.safeParse({
      ...valid,
      contactPhone: "",
      contactEmail: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contactPhone).toBeUndefined();
      expect(result.data.contactEmail).toBeUndefined();
    }
  });

  it("rejects an unknown operating status", () => {
    expect(
      vendorUnitSchema.safeParse({ ...valid, operatingStatus: "vibing" })
        .success,
    ).toBe(false);
  });
});

describe("vendorUnitFormValues", () => {
  it("reads multi-value checkbox fields and boolean toggles from FormData", () => {
    const data = new FormData();
    data.set("name", "Maria's Taco Cart");
    data.set("slug", "marias-taco-cart");
    data.set("unitType", "food_truck");
    data.set("description", "Tacos.");
    data.append("cuisineCategories", "mexican");
    data.append("cuisineCategories", "american");
    data.set("city", "Austin");
    data.set("contactPhoneVisible", "on");
    data.append("paymentMethods", "cash");
    data.set("operatingStatus", "open");

    const values = vendorUnitFormValues(data);
    expect(values.slug).toBe("marias-taco-cart");
    expect(values.cuisineCategories).toEqual(["mexican", "american"]);
    expect(values.paymentMethods).toEqual(["cash"]);
    expect(values.contactPhoneVisible).toBe(true);
    expect(values.contactEmailVisible).toBe(false);
  });
});
