import type { Metadata } from "next";
import Link from "next/link";

import { pageTitle } from "@/lib/app-config";
import { requireVendorSensitiveAction } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import { EditOrganizationForm } from "@/features/organizations/components/edit-organization-form";

export const metadata: Metadata = { title: pageTitle("Edit business details") };

export default async function EditOrganizationPage() {
  const ctx = await requireVendorSensitiveAction(
    ["owner"],
    "/vendor/organization/edit",
  );

  const supabase = await createServerClient();
  const { data: organization } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", ctx.membership.organization_id)
    .maybeSingle();

  if (!organization) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Organization not found
        </h1>
        <Link
          href="/vendor"
          className="mt-4 text-sm text-muted-foreground underline underline-offset-2"
        >
          Back to dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10 sm:py-16">
      <Link
        href="/vendor"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to dashboard
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Edit business details
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Changes apply to the whole organization, not just one cart.
      </p>
      <div className="mt-6">
        <EditOrganizationForm organization={organization} />
      </div>
    </main>
  );
}
