"use server";

import { revalidatePath } from "next/cache";

import { requireVendorMember } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import {
  errorState,
  successState,
  type ActionState,
} from "@/features/authentication/action-state";
import {
  recurringFormValues,
  recurringLocationSchema,
  scheduledAppearanceSchema,
  scheduledFormValues,
  zonedTimestamp,
} from "@/features/vendors/schedule-schemas";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

/**
 * Whoever staffs the cart can say where it is. This matches the live-session
 * rule and the RLS write policy: describing a location is operational, not a
 * management action like changing the reward economics.
 */
const SCHEDULE_ROLES = ["owner", "manager", "staff"] as const;

function friendlyDbError(error: { code?: string; message?: string }): string {
  if (error.code === "23505") {
    return "You already have this exact spot and time saved. Edit that one instead.";
  }
  if (error.code === "P0001" && error.message) {
    return error.message.replace(/^[^:]*:\s*/, "");
  }
  if (error.code === "42501") {
    return "You don't have permission to change this unit's locations.";
  }
  return GENERIC_ERROR;
}

/**
 * Confirm the unit belongs to the caller's own organization before writing.
 *
 * RLS enforces this too — this is the layer that turns a denial into a
 * sentence rather than a raw policy violation.
 */
async function assertOwnUnit(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  organizationId: string,
  unitId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("vendor_units")
    .select("id")
    .eq("id", unitId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return Boolean(data);
}

/* ------------------------------------------------------------------ */
/* Recurring — "where are you usually located?"                        */
/* ------------------------------------------------------------------ */

export async function createRecurringLocationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember([...SCHEDULE_ROLES], "/vendor");
  const parsed = recurringLocationSchema.safeParse(
    recurringFormValues(formData),
  );
  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      parsed.error.flatten().fieldErrors,
    );
  }

  const supabase = await createServerClient();
  const orgId = ctx.membership.organization_id;
  if (!(await assertOwnUnit(supabase, orgId, parsed.data.unitId))) {
    return errorState("That cart or truck could not be found.");
  }

  const { error } = await supabase.from("vendor_recurring_locations").insert({
    organization_id: orgId,
    vendor_unit_id: parsed.data.unitId,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    public_label: parsed.data.publicLabel,
    timezone: parsed.data.timezone,
    days_of_week: parsed.data.daysOfWeek,
    start_time: parsed.data.startTime,
    end_time: parsed.data.endTime,
    effective_from: parsed.data.effectiveFrom?.toISOString().slice(0, 10),
    effective_to: parsed.data.effectiveTo?.toISOString().slice(0, 10),
    // Never client-supplied: the source of a row is decided by who wrote it.
    created_by: ctx.user.id,
  } as never);

  if (error) {
    console.error("recurring location insert failed", { code: error.code });
    return errorState(friendlyDbError(error));
  }

  revalidatePath(`/vendor/unit/${parsed.data.unitId}/schedule`);
  revalidatePath("/vendor");
  return successState("Saved. Customers will see this as “Usually here”.");
}

export async function updateRecurringLocationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember([...SCHEDULE_ROLES], "/vendor");
  const id = formData.get("locationId")?.toString() ?? "";
  if (!id) return errorState(GENERIC_ERROR);

  const parsed = recurringLocationSchema.safeParse(
    recurringFormValues(formData),
  );
  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      parsed.error.flatten().fieldErrors,
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("vendor_recurring_locations")
    .update({
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      public_label: parsed.data.publicLabel,
      timezone: parsed.data.timezone,
      days_of_week: parsed.data.daysOfWeek,
      start_time: parsed.data.startTime,
      end_time: parsed.data.endTime,
      effective_from:
        parsed.data.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      effective_to: parsed.data.effectiveTo?.toISOString().slice(0, 10) ?? null,
      // Editing is itself a confirmation that this is still true today.
      last_confirmed_at: new Date().toISOString(),
      updated_by: ctx.user.id,
    } as never)
    .eq("id", id)
    .eq("organization_id", ctx.membership.organization_id);

  if (error) return errorState(friendlyDbError(error));

  revalidatePath(`/vendor/unit/${parsed.data.unitId}/schedule`);
  return successState("Updated.");
}

/**
 * Restart the 60-day freshness window.
 *
 * This is the whole reason recurring data stays trustworthy: a pattern nobody
 * has reaffirmed in two months stops being shown, and one tap brings it back.
 */
export async function confirmRecurringLocationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember([...SCHEDULE_ROLES], "/vendor");
  const id = formData.get("locationId")?.toString() ?? "";
  const unitId = formData.get("unitId")?.toString() ?? "";
  if (!id) return errorState(GENERIC_ERROR);

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("vendor_recurring_locations")
    .update({
      last_confirmed_at: new Date().toISOString(),
      updated_by: ctx.user.id,
    } as never)
    .eq("id", id)
    .eq("organization_id", ctx.membership.organization_id);

  if (error) return errorState(friendlyDbError(error));

  revalidatePath(`/vendor/unit/${unitId}/schedule`);
  return successState("Confirmed — customers will keep seeing this spot.");
}

export async function setRecurringLocationActiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember([...SCHEDULE_ROLES], "/vendor");
  const id = formData.get("locationId")?.toString() ?? "";
  const unitId = formData.get("unitId")?.toString() ?? "";
  const isActive = formData.get("isActive") === "true";
  if (!id) return errorState(GENERIC_ERROR);

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("vendor_recurring_locations")
    .update({
      is_active: isActive,
      // Turning a spot back on is a fresh claim about the present.
      ...(isActive ? { last_confirmed_at: new Date().toISOString() } : {}),
      updated_by: ctx.user.id,
    } as never)
    .eq("id", id)
    .eq("organization_id", ctx.membership.organization_id);

  if (error) return errorState(friendlyDbError(error));

  revalidatePath(`/vendor/unit/${unitId}/schedule`);
  return successState(
    isActive
      ? "Turned back on. Customers can see this spot again."
      : "Turned off. Customers won't see this spot.",
  );
}

/* ------------------------------------------------------------------ */
/* Scheduled — "where will you be?"                                    */
/* ------------------------------------------------------------------ */

export async function createScheduledAppearanceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember([...SCHEDULE_ROLES], "/vendor");
  const parsed = scheduledAppearanceSchema.safeParse(
    scheduledFormValues(formData),
  );
  if (!parsed.success) {
    return errorState(
      "Please fix the highlighted fields.",
      parsed.error.flatten().fieldErrors,
    );
  }

  const supabase = await createServerClient();
  const orgId = ctx.membership.organization_id;
  if (!(await assertOwnUnit(supabase, orgId, parsed.data.unitId))) {
    return errorState("That cart or truck could not be found.");
  }

  // The vendor typed a wall-clock time; store the instant it names in their
  // own zone, so the stored value stays correct across a DST boundary.
  const startsAt = zonedTimestamp(
    parsed.data.date,
    parsed.data.startTime,
    parsed.data.timezone,
  );
  const endsAt = zonedTimestamp(
    parsed.data.date,
    parsed.data.endTime,
    parsed.data.timezone,
  );

  const { error } = await supabase.from("vendor_scheduled_occurrences").insert({
    organization_id: orgId,
    vendor_unit_id: parsed.data.unitId,
    event_name: parsed.data.eventName ?? null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    public_label: parsed.data.publicLabel,
    // Vendor-authored, so it is confirmed on save. An imported row would
    // enter as UNVERIFIED and stay invisible until a human reviewed it.
    source_type: "VENDOR_SCHEDULED",
    verification: "CONFIRMED",
    confirmed_at: new Date().toISOString(),
    confirmed_by: ctx.user.id,
    created_by: ctx.user.id,
  } as never);

  if (error) {
    console.error("scheduled appearance insert failed", { code: error.code });
    return errorState(friendlyDbError(error));
  }

  revalidatePath(`/vendor/unit/${parsed.data.unitId}/schedule`);
  return successState("Added. Customers will see this on your page.");
}

export async function cancelScheduledAppearanceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireVendorMember([...SCHEDULE_ROLES], "/vendor");
  const id = formData.get("occurrenceId")?.toString() ?? "";
  const unitId = formData.get("unitId")?.toString() ?? "";
  if (!id) return errorState(GENERIC_ERROR);

  const supabase = await createServerClient();
  // Cancelled, not deleted: the row stays for the audit trail and simply
  // leaves the public view.
  const { error } = await supabase
    .from("vendor_scheduled_occurrences")
    .update({ status: "cancelled" } as never)
    .eq("id", id)
    .eq("organization_id", ctx.membership.organization_id);

  if (error) return errorState(friendlyDbError(error));

  revalidatePath(`/vendor/unit/${unitId}/schedule`);
  return successState("Cancelled. Customers won't see it.");
}
