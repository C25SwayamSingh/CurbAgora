import type { Metadata } from "next";
import { redirect } from "next/navigation";

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
import { VendorUnitForm } from "@/features/vendors/components/vendor-unit-form";

export const metadata: Metadata = {
  title: pageTitle("Edit your vendor profile"),
};

export default async function EditVendorUnitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireVendorMember(["owner", "manager"], "/vendor/unit");
  const supabase = await createServerClient();

  // Scoped by both id and the caller's own organization — a manager/owner
  // of one organization can never load another organization's unit into
  // this form, whatever id is in the URL.
  const { data: unit } = await supabase
    .from("vendor_units")
    .select("*")
    .eq("id", id)
    .eq("organization_id", ctx.membership.organization_id)
    .maybeSingle();

  if (!unit) {
    redirect("/vendor");
  }

  return (
    <AuthenticatedAppShell>
      <div className="mx-auto max-w-xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Edit your vendor profile</CardTitle>
            <CardDescription>Keep your public page up to date.</CardDescription>
          </CardHeader>
          <CardContent>
            <VendorUnitForm initialUnit={unit} />
          </CardContent>
        </Card>
      </div>
    </AuthenticatedAppShell>
  );
}
