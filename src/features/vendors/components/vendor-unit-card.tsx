import Link from "next/link";
import { ExternalLink } from "lucide-react";

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
}: {
  unit: VendorUnit;
  organizationSlug: string;
  canManage: boolean;
  /** Any active member (owner/manager/staff) may go live — not just canManage. */
  canManageLocation: boolean;
  locationSession: VendorLocationSession | null;
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
          <VendorLocationControl unitId={unit.id} session={locationSession} />
        ) : null}

        <div className="flex flex-wrap gap-2">
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
