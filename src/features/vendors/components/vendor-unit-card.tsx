import Link from "next/link";
import { CalendarClock, ExternalLink, Gift, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  VendorLocationSession,
  VendorUnit,
} from "@/lib/supabase/database.types";
import { VendorLocationControl } from "@/features/vendors/components/vendor-location-control";
import { VendorUnitPhoto } from "@/features/vendors/components/vendor-unit-photo";
import {
  CUISINE_CATEGORIES,
  OPERATING_STATUSES,
  VENDOR_UNIT_TYPES,
  labelFor,
} from "@/features/vendors/schemas";

/** Summary card for exactly one vendor unit — used in a list, one per unit. */
export function VendorUnitCard({
  unit,
  organizationSlug,
  canManage,
  canManageLocation,
  locationSession,
  loyalty = null,
}: {
  unit: VendorUnit;
  organizationSlug: string;
  canManage: boolean;
  /** Any active member (owner/manager/staff) may go live — not just canManage. */
  canManageLocation: boolean;
  locationSession: VendorLocationSession | null;
  /**
   * The organization's live program, if any. Per-organization rather than
   * per-unit, so every unit shows the same figures — the card repeats them
   * because this is where a vendor looks, not because they differ.
   */
  loyalty?: { pointsPerDollar: number; rewardCount: number } | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <VendorUnitPhoto
            path={unit.primary_image_path}
            displayName={unit.name}
            className="size-10 text-sm"
          />
          {unit.name}
        </CardTitle>
        <CardDescription>
          {labelFor(VENDOR_UNIT_TYPES, unit.unit_type)} · {unit.city}
          {unit.state ? `, ${unit.state}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium">
              {labelFor(OPERATING_STATUSES, unit.operating_status)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cuisine</dt>
            <dd className="font-medium">
              {unit.cuisine_categories.length > 0
                ? unit.cuisine_categories
                    .map((c) => labelFor(CUISINE_CATEGORIES, c))
                    .join(", ")
                : "Not set"}
            </dd>
          </div>
        </dl>

        {canManageLocation ? (
          // Keyed by session identity: when a session starts, ends, or is
          // replaced, this forces a full remount so the internal
          // useActionState hooks (bound to start vs. update actions) never
          // carry stale state from a previous go-live cycle — without
          // this, ending a session and going live again silently failed
          // until a full page reload.
          <VendorLocationControl
            key={locationSession?.id ?? `${unit.id}-not-live`}
            unitId={unit.id}
            session={locationSession}
          />
        ) : null}

        {/*
          Rewards sit on the unit, because that is where the vendor is standing
          when they need them: the printed code belongs to this cart, and the
          checkout screen is what they open to serve its queue. Sending them
          back to a separate dashboard section to find either one is a detour
          during a rush.
        */}
        <div className="rounded-lg border border-border p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-brand">
            <Gift className="size-3.5" aria-hidden="true" />
            Rewards
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {loyalty
              ? `Earning ${loyalty.pointsPerDollar} points per $1 · ${loyalty.rewardCount} reward${loyalty.rewardCount === 1 ? "" : "s"}.`
              : "No rewards program yet — set one up to start earning."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {loyalty ? (
              <Button asChild size="sm">
                <Link href="/vendor/checkout">
                  <QrCode aria-hidden="true" />
                  Checkout
                </Link>
              </Button>
            ) : null}
            {canManage ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/vendor/unit/${unit.id}/qr`}>
                  <QrCode aria-hidden="true" />
                  Printable code
                </Link>
              </Button>
            ) : null}
            {canManage ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/vendor/loyalty">
                  <Gift aria-hidden="true" />
                  {loyalty ? "Change rewards" : "Set up rewards"}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {/*
            Any active member may manage this — saying where the cart parks is
            operational, the same judgement the Go Live control already makes.
          */}
          <Button asChild variant="outline" size="sm">
            <Link href={`/vendor/unit/${unit.id}/schedule`}>
              <CalendarClock aria-hidden="true" />
              Where you are
            </Link>
          </Button>
          {canManage ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/vendor/unit/${unit.id}/edit`}>Edit</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href={`/vendors/${organizationSlug}/${unit.slug}`}>
              <ExternalLink aria-hidden="true" />
              View public page
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
