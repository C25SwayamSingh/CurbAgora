import Link from "next/link";
import { Store } from "lucide-react";

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
import { VendorUnitCard } from "@/features/vendors/components/vendor-unit-card";

/**
 * Dashboard section covering all three vendor-unit states: none yet, one,
 * or several — an organization may operate any number of carts, trucks,
 * stands, stalls, and pop-ups.
 */
export function VendorUnitsSection({
  units,
  organizationSlug,
  canManage,
  canManageLocation,
  openLocationSessionsByUnitId,
}: {
  units: VendorUnit[];
  organizationSlug: string;
  canManage: boolean;
  canManageLocation: boolean;
  openLocationSessionsByUnitId: Record<string, VendorLocationSession>;
}) {
  if (units.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Store className="size-5" aria-hidden="true" />
              Vendor profile
            </span>
          </CardTitle>
          <CardDescription>
            {canManage
              ? "Set up your public vendor profile so customers can find you."
              : "This organization hasn't set up a vendor profile yet."}
          </CardDescription>
        </CardHeader>
        {canManage ? (
          <CardContent>
            <Button asChild>
              <Link href="/vendor/unit/new">Set up your vendor profile</Link>
            </Button>
          </CardContent>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {units.map((unit) => (
        <VendorUnitCard
          key={unit.id}
          unit={unit}
          organizationSlug={organizationSlug}
          canManage={canManage}
          canManageLocation={canManageLocation}
          locationSession={openLocationSessionsByUnitId[unit.id] ?? null}
        />
      ))}
      {canManage ? (
        <Button asChild variant="outline">
          <Link href="/vendor/unit/new">Add another vendor unit</Link>
        </Button>
      ) : null}
    </div>
  );
}
