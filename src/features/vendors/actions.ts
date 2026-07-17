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
  VENDOR_PHOTO_BUCKET,
  validateVendorPhotoFile,
  vendorPhotoObjectPath,
} from "@/features/vendors/photo";
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
 * The optional business photo from the form, or null. Browsers submit an
 * empty File (no name, zero bytes) for an untouched file input — that is
 * "no photo", not a photo to validate.
 */
function photoFromForm(formData: FormData): File | null {
  const value = formData.get("photo");
  if (!(value instanceof File) || value.size === 0 || value.name === "") {
    return null;
  }
  return value;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

/**
 * Upload a photo and point the unit's primary_image_path at it. Returns
 * the new path, or null on failure (logged, never thrown — callers decide
 * whether a failed upload should block their flow).
 */
async function uploadUnitPhoto(
  supabase: SupabaseServerClient,
  organizationId: string,
  unitId: string,
  photo: File,
): Promise<string | null> {
  const path = vendorPhotoObjectPath(organizationId, unitId, photo.type);
  const { error: uploadError } = await supabase.storage
    .from(VENDOR_PHOTO_BUCKET)
    .upload(path, photo, { contentType: photo.type });
  if (uploadError) {
    console.error("vendor photo upload failed", {
      message: uploadError.message,
    });
    return null;
  }
  const { error: pathError } = await supabase
    .from("vendor_units")
    .update({ primary_image_path: path })
    .eq("id", unitId)
    .eq("organization_id", organizationId);
  if (pathError) {
    console.error("vendor photo path update failed", { code: pathError.code });
    return null;
  }
  return path;
}

/** Best-effort storage delete — an orphaned object is logged, never fatal. */
async function removeUnitPhotoObject(
  supabase: SupabaseServerClient,
  path: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(VENDOR_PHOTO_BUCKET)
    .remove([path]);
  if (error) {
    console.error("vendor photo removal failed", { message: error.message });
  }
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

  // Validate the optional photo BEFORE creating anything, so a bad file
  // is a normal field error instead of a half-created unit.
  const photo = photoFromForm(formData);
  if (photo) {
    const photoError = validateVendorPhotoFile(photo);
    if (photoError) {
      return errorState("Please fix the highlighted fields.", {
        photo: [photoError],
      });
    }
  }

  const { data: created, error } = await supabase
    .from("vendor_units")
    .insert({
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
    })
    .select("id")
    .single();

  if (error || !created) {
    if (error?.code === "23505") {
      return errorState(SLUG_TAKEN_ERROR, {
        slug: ["Choose a different URL name."],
      });
    }
    console.error("vendor unit creation failed", { code: error?.code });
    return errorState(GENERIC_ERROR);
  }

  // The unit exists now, so a failed upload must not error the flow —
  // resubmitting would only hit the duplicate-slug error. uploadUnitPhoto
  // logs the failure and the vendor can re-add the photo from Edit.
  if (photo) {
    await uploadUnitPhoto(
      supabase,
      ctx.membership.organization_id,
      created.id,
      photo,
    );
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

  const photo = photoFromForm(formData);
  if (photo) {
    const photoError = validateVendorPhotoFile(photo);
    if (photoError) {
      return errorState("Please fix the highlighted fields.", {
        photo: [photoError],
      });
    }
  }
  const removePhoto = formData.get("removePhoto") === "true";

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
    // primary_image_path is untouched by the update above, so this
    // returns the CURRENT (pre-swap) photo path for cleanup below.
    .select("id, primary_image_path")
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

  const previousPath = data.primary_image_path;

  if (photo) {
    // Upload new → repoint row → delete old, in that order: a failure at
    // any step leaves the unit with a valid (old or new) photo, never a
    // dangling reference.
    const newPath = await uploadUnitPhoto(
      supabase,
      ctx.membership.organization_id,
      unitId,
      photo,
    );
    if (!newPath) {
      return errorState(
        "Your details were saved, but the photo could not be uploaded. Please try again.",
        { photo: ["Try uploading the photo again."] },
      );
    }
    if (previousPath) {
      await removeUnitPhotoObject(supabase, previousPath);
    }
  } else if (removePhoto && previousPath) {
    const { error: clearError } = await supabase
      .from("vendor_units")
      .update({ primary_image_path: null })
      .eq("id", unitId)
      .eq("organization_id", ctx.membership.organization_id);
    if (clearError) {
      console.error("vendor photo clear failed", { code: clearError.code });
      return errorState(GENERIC_ERROR);
    }
    await removeUnitPhotoObject(supabase, previousPath);
  }

  redirect("/vendor");
}
