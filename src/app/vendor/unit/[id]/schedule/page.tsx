import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AuthenticatedAppShell } from "@/components/app/authenticated-app-shell";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/app-config";
import { requireVendorMember } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import {
  ScheduleManager,
  type RecurringRow,
  type ScheduledRow,
} from "@/features/vendors/components/schedule-manager";
import { location_recurring_stale_days } from "@/features/vendors/schedule-constants";

export const metadata: Metadata = { title: pageTitle("Where you are") };

/**
 * Whether a recurring row's confirmation is still inside the freshness window.
 * Kept out of the component body so the `Date.now()` read isn't treated as an
 * impure call during render (the same reason `formatVerified` lives apart).
 */
function isConfirmationCurrent(
  lastConfirmedAt: string,
  staleDays: number,
): boolean {
  const staleMs = staleDays * 86_400_000;
  return Date.now() - new Date(lastConfirmedAt).getTime() < staleMs;
}

/**
 * Everything CurbAgora believes about one unit's location, in one place.
 *
 * Any active member may manage this — describing where the cart parks is
 * operational, the same judgement the live-session flow already makes. It is
 * not a management action like changing reward economics.
 */
export default async function VendorUnitSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireVendorMember(
    ["owner", "manager", "staff"],
    "/vendor",
  );
  const supabase = await createServerClient();

  // Scoped by the caller's own organization, so another org's id in the URL
  // resolves to nothing rather than exposing their schedule.
  const [{ data: unit }, { data: recurringRows }, { data: scheduledRows }] =
    await Promise.all([
      supabase
        .from("vendor_units")
        .select("id, name")
        .eq("id", id)
        .eq("organization_id", ctx.membership.organization_id)
        .maybeSingle(),
      supabase
        .from("vendor_recurring_locations")
        .select("*")
        .eq("vendor_unit_id", id)
        .eq("organization_id", ctx.membership.organization_id)
        .order("created_at"),
      supabase
        .from("vendor_scheduled_occurrences")
        .select("*")
        .eq("vendor_unit_id", id)
        .eq("organization_id", ctx.membership.organization_id)
        .eq("status", "scheduled")
        .gte("ends_at", new Date().toISOString())
        .order("starts_at"),
    ]);

  if (!unit) notFound();

  const recurring: RecurringRow[] = (recurringRows ?? []).map((row) => ({
    id: row.id,
    publicLabel: row.public_label,
    latitude: row.latitude,
    longitude: row.longitude,
    timezone: row.timezone,
    daysOfWeek: row.days_of_week,
    // Postgres `time` comes back as HH:MM:SS; the form wants HH:MM.
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    isActive: row.is_active,
    lastConfirmedAt: row.last_confirmed_at,
    isCurrent: isConfirmationCurrent(
      row.last_confirmed_at,
      location_recurring_stale_days,
    ),
  }));

  const scheduled: ScheduledRow[] = (scheduledRows ?? []).map((row) => ({
    id: row.id,
    publicLabel: row.public_label,
    eventName: row.event_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  }));

  return (
    <AuthenticatedAppShell>
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link href="/vendor">
              <ArrowLeft aria-hidden="true" />
              Vendor dashboard
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            Where you are
          </h1>
          <p className="text-sm text-muted-foreground">
            Tell customers where to find {unit.name} — now, on a normal week,
            and on specific dates.
          </p>
        </div>

        <ScheduleManager
          unitId={unit.id}
          unitName={unit.name}
          recurring={recurring}
          scheduled={scheduled}
        />
      </div>
    </AuthenticatedAppShell>
  );
}
