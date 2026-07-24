import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AuthenticatedAppShell } from "@/components/app/authenticated-app-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/app-config";
import { requireVendorMember } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import { StaffCheckout } from "@/features/loyalty/components/staff-checkout";

export const metadata: Metadata = { title: pageTitle("Checkout") };

/**
 * The counter screen. Any staff member of the organization can reach it —
 * awarding points is the job, not a privileged setting — while publishing and
 * pausing the program stay owner/manager only over on /vendor/loyalty.
 *
 * Deliberately its own route rather than a panel on the dashboard: a vendor
 * serving a line should be able to leave this open all shift and never
 * navigate away between customers.
 */
export default async function VendorCheckoutPage() {
  const ctx = await requireVendorMember(undefined, "/vendor/checkout");
  const supabase = await createServerClient();

  const [{ data: version }, { data: program }] = await Promise.all([
    supabase
      .from("loyalty_program_versions")
      .select("points_per_dollar")
      .eq("organization_id", ctx.membership.organization_id)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("loyalty_programs")
      .select("earning_paused")
      .eq("organization_id", ctx.membership.organization_id)
      .maybeSingle(),
  ]);

  const pointsPerDollar = version?.points_per_dollar ?? null;

  return (
    <AuthenticatedAppShell>
      <div className="mx-auto max-w-md space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Identify customer
          </h1>
          {pointsPerDollar ? (
            <p className="text-sm text-muted-foreground">
              {pointsPerDollar} points per $1 of eligible spend.
            </p>
          ) : null}
        </div>

        {pointsPerDollar === null ? (
          <Alert>
            <AlertDescription>
              You don&apos;t have an active points program yet. Publish one
              first and customers can start earning.
            </AlertDescription>
          </Alert>
        ) : program?.earning_paused ? (
          <Alert>
            <AlertDescription>
              Earning is paused. Resume it on the rewards page before awarding
              points.
            </AlertDescription>
          </Alert>
        ) : (
          <StaffCheckout pointsPerDollar={pointsPerDollar} />
        )}

        {/*
          Back goes to the dashboard, not to the rewards program. A vendor
          leaving checkout is done serving and heading for the hub — going live,
          the printed code, their units. Changing the reward catalog is a rare,
          deliberate act reached from there; routing the only exit through it
          made every trip back a two-step detour.
        */}
        <Button asChild variant="ghost" size="sm">
          <Link href="/vendor">
            <ArrowLeft aria-hidden="true" />
            Vendor dashboard
          </Link>
        </Button>
      </div>
    </AuthenticatedAppShell>
  );
}
