import { z } from "zod";

import type {
  CuisineCategory,
  PaymentMethod,
  VendorOperatingStatus,
  VendorUnitType,
} from "@/lib/supabase/database.types";
import { SLUG_PATTERN, suggestSlug } from "@/features/organizations/schemas";

export { suggestSlug };

/** Look up an option's display label; falls back to the raw value. */
export function labelFor<T extends string>(
  options: { value: T; label: string }[],
  value: T,
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export const VENDOR_UNIT_TYPES: { value: VendorUnitType; label: string }[] = [
  { value: "food_cart", label: "Food cart" },
  { value: "food_truck", label: "Food truck" },
  { value: "stand", label: "Stand" },
  { value: "stall", label: "Stall" },
  { value: "pop_up", label: "Pop-up" },
];

export const CUISINE_CATEGORIES: { value: CuisineCategory; label: string }[] = [
  { value: "american", label: "American" },
  { value: "mexican", label: "Mexican" },
  { value: "asian", label: "Asian" },
  { value: "italian", label: "Italian" },
  { value: "mediterranean", label: "Mediterranean" },
  { value: "indian", label: "Indian" },
  { value: "bbq", label: "BBQ" },
  { value: "desserts", label: "Desserts" },
  { value: "coffee_and_drinks", label: "Coffee & drinks" },
  { value: "vegan_vegetarian", label: "Vegan & vegetarian" },
  { value: "other", label: "Other" },
];

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "credit_card", label: "Credit card" },
  { value: "debit_card", label: "Debit card" },
  { value: "mobile_pay", label: "Mobile pay" },
  { value: "contactless", label: "Contactless" },
];

export const OPERATING_STATUSES: {
  value: VendorOperatingStatus;
  label: string;
}[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "temporarily_closed", label: "Temporarily closed" },
];

const unitTypeValues = VENDOR_UNIT_TYPES.map((t) => t.value) as [
  VendorUnitType,
  ...VendorUnitType[],
];
const cuisineCategoryValues = CUISINE_CATEGORIES.map((c) => c.value) as [
  CuisineCategory,
  ...CuisineCategory[],
];
const paymentMethodValues = PAYMENT_METHODS.map((p) => p.value) as [
  PaymentMethod,
  ...PaymentMethod[],
];
const operatingStatusValues = OPERATING_STATUSES.map((s) => s.value) as [
  VendorOperatingStatus,
  ...VendorOperatingStatus[],
];

/** Blank/missing optional text fields arrive as "" or null from FormData. */
function emptyToUndefined(value: unknown) {
  return value === "" || value === null ? undefined : value;
}

export const vendorUnitSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Vendor name must be at least 2 characters")
    .max(120, "Vendor name is too long"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      SLUG_PATTERN,
      "Use 2-48 lowercase letters, numbers, and hyphens (no leading/trailing hyphen)",
    ),
  unitType: z.enum(unitTypeValues, {
    message: "Choose a vendor type",
  }),
  description: z
    .string()
    .trim()
    .max(280, "Description is too long (280 characters max)")
    .default(""),
  cuisineCategories: z
    .array(z.enum(cuisineCategoryValues))
    .max(5, "Choose up to 5 cuisine categories")
    .default([]),
  city: z
    .string()
    .trim()
    .min(1, "City is required")
    .max(120, "City name is too long"),
  contactPhone: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(32, "Phone number is too long")
      .regex(/^[0-9+()\-.\s]+$/, "Enter a valid phone number")
      .optional(),
  ),
  contactPhoneVisible: z.boolean().default(false),
  contactEmail: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(254, "Email is too long")
      .email("Enter a valid email address")
      .optional(),
  ),
  contactEmailVisible: z.boolean().default(false),
  paymentMethods: z
    .array(z.enum(paymentMethodValues))
    .max(6, "Choose up to 6 payment methods")
    .default([]),
  operatingStatus: z.enum(operatingStatusValues, {
    message: "Choose an operating status",
  }),
});

export type VendorUnitInput = z.infer<typeof vendorUnitSchema>;

/** Parse a vendor unit form submission into the shape vendorUnitSchema expects. */
export function vendorUnitFormValues(formData: FormData) {
  return {
    name: formData.get("name"),
    slug: formData.get("slug"),
    unitType: formData.get("unitType"),
    description: formData.get("description"),
    cuisineCategories: formData.getAll("cuisineCategories"),
    city: formData.get("city"),
    contactPhone: formData.get("contactPhone"),
    contactPhoneVisible: formData.get("contactPhoneVisible") === "on",
    contactEmail: formData.get("contactEmail"),
    contactEmailVisible: formData.get("contactEmailVisible") === "on",
    paymentMethods: formData.getAll("paymentMethods"),
    operatingStatus: formData.get("operatingStatus"),
  };
}
