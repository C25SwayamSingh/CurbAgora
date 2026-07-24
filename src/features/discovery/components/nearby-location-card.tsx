"use client";

import Link from "next/link";
import { ExternalLink, Info, MapPin } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NearbyVendorLocation } from "@/lib/supabase/database.types";
import { VendorUnitPhoto } from "@/features/vendors/components/vendor-unit-photo";
import {
  CUISINE_CATEGORIES,
  VENDOR_UNIT_TYPES,
  labelFor,
} from "@/features/vendors/schemas";
import { STATE_STYLES, isHotspot } from "@/features/discovery/location-state";

export function formatDistance(miles: number) {
  return miles < 0.1 ? "< 0.1 mi" : `${miles.toFixed(1)} mi`;
}

function formatVerified(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days === 0) return "Confirmed today";
  if (days === 1) return "Confirmed yesterday";
  if (days < 30) return `Confirmed ${days} days ago`;
  return `Confirmed ${then.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/**
 * One discovery result, in any of the four states.
 *
 * A hotspot renders through a deliberately different branch: no photo, no
 * cuisine, no vendor link, and an explicit note that nobody is confirmed. The
 * shapes are kept apart in code rather than by conditionals inside one layout,
 * because the failure mode to avoid — a parking zone that looks like a claimed
 * business — is exactly what a shared layout with a few nulls produces.
 */
export function NearbyLocationCard({
  result,
  selected,
  onSelect,
}: {
  result: NearbyVendorLocation;
  selected: boolean;
  onSelect: (resultId: string) => void;
}) {
  const style = STATE_STYLES[result.state];
  const verified = formatVerified(result.last_verified_at);

  const shell = (children: React.ReactNode) => (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => onSelect(result.result_id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(result.result_id);
          }
        }}
        className={cn(
          "cursor-pointer rounded-lg border bg-card p-3 transition-colors",
          selected
            ? "border-secondary bg-accent/40 ring-1 ring-secondary"
            : "border-border hover:bg-accent/40",
        )}
      >
        {children}
      </div>
    </li>
  );

  if (isHotspot(result)) {
    return shell(
      <div className="flex items-start gap-3">
        <div
          className="flex size-12 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
          aria-hidden="true"
        >
          <MapPin className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{result.public_label}</p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                style.badgeClass,
              )}
            >
              {style.badge}
            </span>
            <span className="ml-auto text-sm text-muted-foreground">
              {formatDistance(result.distance_miles)}
            </span>
          </div>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {result.reason_label}
          </p>
          {/*
            No "where this came from" link: the ranking query returns
            source_type but not source_url, so linking it would render a
            permanently dead anchor. Surfacing provenance to customers needs
            the RPC to return the URL first — a deliberate later decision,
            since it also means publishing which dataset a row came from.
          */}
        </div>
      </div>,
    );
  }

  return shell(
    <div className="flex items-start gap-3">
      <VendorUnitPhoto
        path={result.primary_image_path}
        displayName={result.name ?? result.public_label}
        className="size-12 text-sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{result.name ?? result.public_label}</p>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              style.badgeClass,
            )}
          >
            {style.badge}
          </span>
          <span className="ml-auto text-sm text-muted-foreground">
            {formatDistance(result.distance_miles)}
          </span>
        </div>
        {result.unit_type ? (
          <p className="text-sm text-muted-foreground">
            {labelFor(VENDOR_UNIT_TYPES, result.unit_type)}
            {result.cuisine_categories && result.cuisine_categories.length > 0
              ? ` · ${result.cuisine_categories
                  .map((c) => labelFor(CUISINE_CATEGORIES, c))
                  .join(", ")}`
              : ""}
          </p>
        ) : null}
        <p className="mt-1 flex items-center gap-1.5 text-sm">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          {result.public_label}
        </p>
        {/* The same sentence the marker announces — one source of truth. */}
        <p className="mt-0.5 text-sm text-muted-foreground">
          {result.reason_label}
        </p>
        {verified && result.state !== "LIVE" ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{verified}</p>
        ) : null}
        {result.organization_slug && result.unit_slug ? (
          <Link
            href={`/vendors/${result.organization_slug}/${result.unit_slug}`}
            onClick={(event) => event.stopPropagation()}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-2"
          >
            View page
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </div>,
  );
}
