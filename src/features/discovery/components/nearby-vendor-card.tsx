"use client";

import Link from "next/link";
import { Clock, ExternalLink, MapPin } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NearbyLiveVendor } from "@/lib/supabase/database.types";
import { VendorUnitPhoto } from "@/features/vendors/components/vendor-unit-photo";
import {
  CUISINE_CATEGORIES,
  VENDOR_UNIT_TYPES,
  labelFor,
} from "@/features/vendors/schemas";

export function formatDistance(miles: number) {
  return miles < 0.1 ? "< 0.1 mi" : `${miles.toFixed(1)} mi`;
}

function formatEndTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * One nearby result. The whole card is a selection target (syncs with the
 * map marker); the public-page link is a separate, real link.
 */
export function NearbyVendorCard({
  vendor,
  selected,
  onSelect,
}: {
  vendor: NearbyLiveVendor;
  selected: boolean;
  onSelect: (vendorUnitId: string) => void;
}) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => onSelect(vendor.vendor_unit_id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(vendor.vendor_unit_id);
          }
        }}
        className={cn(
          "cursor-pointer rounded-lg border bg-card p-3 transition-colors",
          selected
            ? "border-secondary ring-1 ring-secondary bg-accent/40"
            : "border-border hover:bg-accent/40",
        )}
      >
        <div className="flex items-start gap-3">
          <VendorUnitPhoto
            path={vendor.primary_image_path}
            displayName={vendor.name}
            className="size-12 text-sm"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{vendor.name}</p>
              <span className="rounded-full bg-live/15 px-2 py-0.5 text-xs font-medium text-live">
                Live now
              </span>
              <span className="ml-auto text-sm text-muted-foreground">
                {formatDistance(vendor.distance_miles)}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {labelFor(VENDOR_UNIT_TYPES, vendor.unit_type)}
              {vendor.cuisine_categories.length > 0
                ? ` · ${vendor.cuisine_categories
                    .map((c) => labelFor(CUISINE_CATEGORIES, c))
                    .join(", ")}`
                : ""}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm">
              <MapPin
                className="size-3.5 shrink-0 text-live"
                aria-hidden="true"
              />
              {vendor.public_label}
            </p>
            {vendor.expected_end_at ? (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3 shrink-0" aria-hidden="true" />
                Expected until {formatEndTime(vendor.expected_end_at)}
              </p>
            ) : null}
            <Link
              href={`/vendors/${vendor.organization_slug}/${vendor.unit_slug}`}
              onClick={(event) => event.stopPropagation()}
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-2"
            >
              View page
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </li>
  );
}
