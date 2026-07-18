import type { Metadata } from "next";

import { AuthenticatedAppShell } from "@/components/app/authenticated-app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { pageTitle } from "@/lib/app-config";
import { requireVendorMember } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import { isGooglePlacesConfigured } from "@/lib/geocoding/google-places";
import { VendorUnitForm } from "@/features/vendors/components/vendor-unit-form";

export const metadata: Metadata = {
  title: pageTitle("Set up your vendor profile"),
};

export default async function NewVendorUnitPage() {
  // An organization may operate any number of vendor units — always show
  // the create form, never redirect based on how many already exist.
  const ctx = await requireVendorMember(
    ["owner", "manager"],
    "/vendor/unit/new",
  );

  const supabase = await createServerClient();
  const { data: organization } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", ctx.membership.organization_id)
    .maybeSingle();

  return (
    <AuthenticatedAppShell>
      <div className="mx-auto max-w-xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Set up a vendor profile</CardTitle>
            <CardDescription>
              This is what customers will see on its public page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VendorUnitForm
              organizationSlug={organization?.slug ?? ""}
              placesConfigured={isGooglePlacesConfigured()}
            />
          </CardContent>
        </Card>
      </div>
    </AuthenticatedAppShell>
  );
}
