"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireVendorMember } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import {
  errorState,
  type ActionState,
} from "@/features/authentication/action-state";
import {
  vendorUnitFormValues,
  vendorUnitSchema,
} from "@/features/vendors/schemas";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const SLUG_TAKEN_ERROR =
  "That URL name is already used by another of your vendor units.";

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

  const { error } = await supabase.from("vendor_units").insert({
    organization_id: ctx.membership.organization_id,
    created_by: ctx.user.id,
    name: parsed.data.name,
    slug: parsed.data.slug,
    unit_type: parsed.data.unitType,
    description: parsed.data.description,
    cuisine_categories: parsed.data.cuisineCategories,
    city: parsed.data.city,
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

  const { data, error } = await supabase
    .from("vendor_units")
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      unit_type: parsed.data.unitType,
      description: parsed.data.description,
      cuisine_categories: parsed.data.cuisineCategories,
      city: parsed.data.city,
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
