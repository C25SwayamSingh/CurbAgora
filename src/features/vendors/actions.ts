"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireVendorMember } from "@/lib/auth/guards";
import {
  shouldVerifyCity,
  verifyCityPlace,
} from "@/lib/geocoding/google-places";
import { createServerClient } from "@/lib/supabase/server";
import {
  errorState,
  type ActionState,
} from "@/features/authentication/action-state";
import {
  vendorUnitFormValues,
  vendorUnitSchema,
  type VendorUnitInput,
} from "@/features/vendors/schemas";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const SLUG_TAKEN_ERROR =
  "That URL name is already used by another of your vendor units.";
const CITY_NOT_VERIFIED_ERROR = "Select a city from the suggestions.";

/**
 * Re-verifies the submitted city server-side against Google Places before
 * a vendor unit is saved — the client-side autocomplete is UX, this is
 * the actual enforcement (per docs/SECURITY_MODEL.md: all inputs
 * re-validated server-side). Skipped entirely when Places isn't
 * configured in development (see shouldVerifyCity docs); in any other
 * environment a missing/invalid placeId or a mismatched state fails
 * closed with a field error rather than trusting client-submitted text.
 */
async function verifyCityOrError(
  data: Pick<VendorUnitInput, "placeId" | "state">,
): Promise<ReturnType<typeof errorState> | null> {
  if (!shouldVerifyCity()) {
    return null;
  }
  if (!data.placeId) {
    return errorState(CITY_NOT_VERIFIED_ERROR, {
      city: ["Select a city from the dropdown so it can be verified."],
    });
  }
  let verified;
  try {
    verified = await verifyCityPlace(data.placeId);
  } catch (err) {
    console.error("city verification failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return errorState(
      "Something went wrong verifying your city. Please try again.",
    );
  }
  if (!verified || verified.state !== data.state) {
    return errorState(CITY_NOT_VERIFIED_ERROR, {
      city: ["Select a valid city from the suggestions."],
    });
  }
  return null;
}

/**
 * Create a vendor unit for the caller's organization. An organization may
 * have any number of units (food_cart/food_truck/stand/stall/pop_up) — only
 * the (organization, slug) pair is unique. Only owners/managers may create
 * one; the organization is always derived from the caller's own membership,
 * never from client input. MFA is not required: this mirrors organization
 * creation, not a sensitive management action.
 */
export async function createVendorUnitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember(
    ["owner", "manager"],
    "/vendor/unit/new",
  );
  const supabase = await createServerClient();

  const parsed = vendorUnitSchema.safeParse(vendorUnitFormValues(formData));

  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const cityError = await verifyCityOrError(parsed.data);
  if (cityError) {
    return cityError;
  }

  const { error } = await supabase.from("vendor_units").insert({
    organization_id: ctx.membership.organization_id,
    created_by: ctx.user.id,
    name: parsed.data.name,
    slug: parsed.data.slug,
    unit_type: parsed.data.unitType,
    description: parsed.data.description,
    cuisine_categories: parsed.data.cuisineCategories,
    city: parsed.data.city,
    state: parsed.data.state,
    neighborhood: parsed.data.neighborhood ?? null,
    contact_phone: parsed.data.contactPhone ?? null,
    contact_phone_visible: parsed.data.contactPhoneVisible,
    contact_email: parsed.data.contactEmail ?? null,
    contact_email_visible: parsed.data.contactEmailVisible,
    payment_methods: parsed.data.paymentMethods,
    operating_status: parsed.data.operatingStatus,
  });

  if (error) {
    if (error.code === "23505") {
      return errorState(SLUG_TAKEN_ERROR, {
        slug: ["Choose a different URL name."],
      });
    }
    console.error("vendor unit creation failed", { code: error.code });
    return errorState(GENERIC_ERROR);
  }

  redirect("/vendor");
}

/**
 * Update one vendor unit, identified by the hidden `unitId` field. Scoped
 * by both id AND the caller's own organization_id (belt-and-suspenders on
 * top of the RLS owner/manager-of-that-org check) — a client can never
 * target another organization's unit, whatever id it sends.
 */
export async function updateVendorUnitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember(["owner", "manager"], "/vendor/unit");
  const supabase = await createServerClient();

  const unitId = formData.get("unitId")?.toString();
  if (!unitId) {
    return errorState(GENERIC_ERROR);
  }

  const parsed = vendorUnitSchema.safeParse(vendorUnitFormValues(formData));

  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const cityError = await verifyCityOrError(parsed.data);
  if (cityError) {
    return cityError;
  }

  const { data, error } = await supabase
    .from("vendor_units")
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      unit_type: parsed.data.unitType,
      description: parsed.data.description,
      cuisine_categories: parsed.data.cuisineCategories,
      city: parsed.data.city,
      state: parsed.data.state,
      neighborhood: parsed.data.neighborhood ?? null,
      contact_phone: parsed.data.contactPhone ?? null,
      contact_phone_visible: parsed.data.contactPhoneVisible,
      contact_email: parsed.data.contactEmail ?? null,
      contact_email_visible: parsed.data.contactEmailVisible,
      payment_methods: parsed.data.paymentMethods,
      operating_status: parsed.data.operatingStatus,
    })
    .eq("id", unitId)
    .eq("organization_id", ctx.membership.organization_id)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return errorState(SLUG_TAKEN_ERROR, {
        slug: ["Choose a different URL name."],
      });
    }
    console.error("vendor unit update failed", { code: error.code });
    return errorState(GENERIC_ERROR);
  }

  if (!data) {
    return errorState("That vendor unit could not be found.");
  }

  redirect("/vendor");
}
