"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireVendorMember } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import {
  errorState,
  successState,
  type ActionState,
} from "@/features/authentication/action-state";
import {
  endLocationSessionSchema,
  locationSessionFormValues,
  startLocationSessionSchema,
  updateLocationSessionSchema,
} from "@/features/vendors/schemas";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const ALREADY_LIVE_ERROR =
  "This vendor unit already has an active session. End it before starting a new one.";
const UNIT_NOT_FOUND_ERROR = "That vendor unit could not be found.";
const SESSION_NOT_FOUND_ERROR = "That session could not be found.";

/**
 * Any active member (owner, manager, or staff) may start, update, or end a
 * location session — this is operational (whoever is staffing the cart
 * that day), not a sensitive management action, matching the RLS write
 * policy on vendor_location_sessions. See the migration's comment for why
 * this differs from vendor_units CRUD, which stays owner/manager-only.
 */
const LOCATION_SESSION_ROLES = ["owner", "manager", "staff"] as const;

/**
 * Start a new "go live" session for a vendor unit. Fails with a clear
 * field error (not a raw database error) if the unit already has an open
 * session — the caller must end it first; this action never auto-ends a
 * prior session, so the audit trail stays honest.
 */
export async function startLocationSessionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember([...LOCATION_SESSION_ROLES], "/vendor");
  const supabase = await createServerClient();

  const parsed = startLocationSessionSchema.safeParse(
    locationSessionFormValues(formData),
  );
  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const { error } = await supabase.from("vendor_location_sessions").insert({
    vendor_unit_id: parsed.data.unitId,
    organization_id: ctx.membership.organization_id,
    created_by: ctx.user.id,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    public_label: parsed.data.publicLabel,
    expected_end_at: parsed.data.expectedEndAt?.toISOString() ?? null,
  });

  if (error) {
    if (error.code === "23505") {
      return errorState(ALREADY_LIVE_ERROR);
    }
    if (error.code === "42501") {
      return errorState(UNIT_NOT_FOUND_ERROR, {
        unitId: [UNIT_NOT_FOUND_ERROR],
      });
    }
    console.error("location session start failed", { code: error.code });
    return errorState(GENERIC_ERROR);
  }

  revalidatePath("/vendor");
  return successState("You're live.");
}

/**
 * Update an existing open session's location/label/expected-end time.
 * Also bumps last_confirmed_at — any deliberate update is itself a
 * confirmation the vendor is still there, so a separate "confirm" action
 * isn't needed.
 */
export async function updateLocationSessionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember([...LOCATION_SESSION_ROLES], "/vendor");
  const supabase = await createServerClient();

  const parsed = updateLocationSessionSchema.safeParse(
    locationSessionFormValues(formData),
  );
  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const { data, error } = await supabase
    .from("vendor_location_sessions")
    .update({
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      public_label: parsed.data.publicLabel,
      expected_end_at: parsed.data.expectedEndAt?.toISOString() ?? null,
      last_confirmed_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.sessionId)
    .eq("organization_id", ctx.membership.organization_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("location session update failed", { code: error.code });
    return errorState(GENERIC_ERROR);
  }

  if (!data) {
    return errorState(SESSION_NOT_FOUND_ERROR);
  }

  revalidatePath("/vendor");
  return successState("Location updated.");
}

/** End an open session. */
export async function endLocationSessionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember([...LOCATION_SESSION_ROLES], "/vendor");
  const supabase = await createServerClient();

  const parsed = endLocationSessionSchema.safeParse(
    locationSessionFormValues(formData),
  );
  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  const { data, error } = await supabase
    .from("vendor_location_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", parsed.data.sessionId)
    .eq("organization_id", ctx.membership.organization_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("location session end failed", { code: error.code });
    return errorState(GENERIC_ERROR);
  }

  if (!data) {
    return errorState(SESSION_NOT_FOUND_ERROR);
  }

  revalidatePath("/vendor");
  return successState("Session ended.");
}
