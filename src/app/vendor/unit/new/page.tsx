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
import { VendorUnitForm } from "@/features/vendors/components/vendor-unit-form";

export const metadata: Metadata = {
  title: pageTitle("Set up your vendor profile"),
};

export default async function NewVendorUnitPage() {
  // An organization may operate any number of vendor units — always show
  // the create form, never redirect based on how many already exist.
  await requireVendorMember(["owner", "manager"], "/vendor/unit/new");

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
            <VendorUnitForm />
          </CardContent>
        </Card>
      </div>
    </AuthenticatedAppShell>
  );
}
