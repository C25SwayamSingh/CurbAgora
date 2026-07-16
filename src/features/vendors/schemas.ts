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

/**
 * Predefined cuisine suggestions. Storage is free-form text (see
 * vendorUnitSchema below) so a vendor may also add custom entries not in
 * this list — CUISINE_CATEGORIES only drives the quick-pick pills.
 */
export const CUISINE_CATEGORIES: { value: CuisineCategory; label: string }[] = [
  { value: "halal", label: "Halal" },
  { value: "mediterranean", label: "Mediterranean" },
  { value: "desserts", label: "Desserts" },
  { value: "coffee_and_drinks", label: "Coffee & drinks" },
  { value: "mexican", label: "Mexican" },
  { value: "asian", label: "Asian" },
  { value: "italian", label: "Italian" },
  { value: "indian", label: "Indian" },
  { value: "bbq", label: "BBQ" },
  { value: "vegan_vegetarian", label: "Vegan & vegetarian" },
  { value: "american", label: "American" },
];

/** Max combined predefined + custom cuisine entries per vendor unit. */
export const MAX_CUISINE_ENTRIES = 8;

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "credit_card", label: "Credit card" },
  { value: "debit_card", label: "Debit card" },
  { value: "mobile_pay", label: "Mobile pay" },
  { value: "contactless", label: "Contactless" },
];

/** USPS 2-letter codes for the 50 states + DC. */
export const US_STATES: { value: string; label: string }[] = [
  { value: "AL", label: "Alabama" },
  { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" },
  { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" },
  { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" },
  { value: "DE", label: "Delaware" },
  { value: "DC", label: "District of Columbia" },
  { value: "FL", label: "Florida" },
  { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" },
  { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" },
  { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" },
  { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" },
  { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" },
  { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" },
  { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" },
  { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" },
  { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" },
  { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" },
  { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" },
  { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" },
  { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" },
  { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" },
  { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" },
  { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" },
  { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" },
  { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" },
  { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" },
  { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" },
  { value: "WY", label: "Wyoming" },
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
const paymentMethodValues = PAYMENT_METHODS.map((p) => p.value) as [
  PaymentMethod,
  ...PaymentMethod[],
];
const operatingStatusValues = OPERATING_STATUSES.map((s) => s.value) as [
  VendorOperatingStatus,
  ...VendorOperatingStatus[],
];
const stateValues = US_STATES.map((s) => s.value) as [string, ...string[]];

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
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(40, "Each cuisine entry must be 40 characters or fewer"),
    )
    .default([])
    .transform((values) => {
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const value of values) {
        const key = value.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(value);
        }
      }
      return deduped;
    })
    .pipe(
      z
        .array(z.string())
        .max(
          MAX_CUISINE_ENTRIES,
          `Choose up to ${MAX_CUISINE_ENTRIES} cuisine categories`,
        ),
    ),
  city: z
    .string()
    .trim()
    .min(1, "City is required")
    .max(120, "City name is too long"),
  state: z.enum(stateValues, {
    message: "Choose a state",
  }),
  neighborhood: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(120, "Neighborhood is too long").optional(),
  ),
  /**
   * Set only when the city was selected from the autocomplete dropdown —
   * used server-side (see actions.ts) to re-verify the place is a real
   * city before saving. Absent when Google Places isn't configured or the
   * vendor typed the city manually; in that case city/state are trusted
   * as plain text, same as before this feature existed.
   */
  placeId: z.preprocess(emptyToUndefined, z.string().optional()),
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
    state: formData.get("state"),
    neighborhood: formData.get("neighborhood"),
    placeId: formData.get("placeId"),
    contactPhone: formData.get("contactPhone"),
    contactPhoneVisible: formData.get("contactPhoneVisible") === "on",
    contactEmail: formData.get("contactEmail"),
    contactEmailVisible: formData.get("contactEmailVisible") === "on",
    paymentMethods: formData.getAll("paymentMethods"),
    operatingStatus: formData.get("operatingStatus"),
  };
}
