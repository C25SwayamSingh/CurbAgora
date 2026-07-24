import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";

import { AuthenticatedAppShell } from "@/components/app/authenticated-app-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/app-config";
import { requireAuth } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import { CheckoutCodeCard } from "@/features/loyalty/components/checkout-code-card";
import { formatPoints, rewardDisplayLabel } from "@/features/loyalty/engine";
import type { LoyaltyCatalogPreviewItem } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: pageTitle("Checkout code") };

/**
 * Where the cart's permanent printed QR lands.
 *
 * The permanent QR is deliberately inert — scanning it proves only that
 * someone stood near the cart, never that they bought anything. All it does is
 * open this page for the right vendor. Points still require a staff member to
 * enter the register amount against the DYNAMIC code shown below.
 *
 * A signed-out visitor is bounced through sign-in and returned here, so the
 * whole path from "scanned a sticker" to "showing a code" is one continuous
 * flow rather than a hunt through the dashboard.
 */
export default async function VendorRewardsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; unitSlug: string }>;
}) {
  const { orgSlug, unitSlug } = await params;
  const ctx = await requireAuth(`/vendors/${orgSlug}/${unitSlug}/rewards`);

  const supabase = await createServerClient();
  const [{ data: unit }, { data: loyalty }] = await Promise.all([
    supabase
      .from("vendor_unit_previews")
      .select("*")
      .eq("organization_slug", orgSlug)
      .eq("slug", unitSlug)
      .maybeSingle(),
    supabase
      .from("loyalty_program_previews")
      .select("*")
      .eq("organization_slug", orgSlug)
      .maybeSingle(),
  ]);

  if (!unit) notFound();

  const profileHref = `/vendors/${orgSlug}/${unitSlug}`;

  if (!loyalty) {
    return (
      <AuthenticatedAppShell>
        <div className="mx-auto max-w-md space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">{unit.name}</h1>
          <p className="text-sm text-muted-foreground">
            This vendor doesn&apos;t have a rewards program yet.
          </p>
          <Button asChild variant="outline">
            <Link href={profileHref}>
              <ArrowLeft aria-hidden="true" />
              Back to {unit.name}
            </Link>
          </Button>
        </div>
      </AuthenticatedAppShell>
    );
  }

  // The account row may not exist yet — a first-time customer creates it by
  // opening their first code, so a zero balance is the honest starting point.
  const { data: account } = await supabase
    .from("loyalty_accounts")
    .select("point_balance")
    .eq("organization_id", loyalty.organization_id)
    .maybeSingle();

  // A vendor arriving here from their own QR page is looking at a customer
  // screen. Saying so removes the "wait, who is this for?" moment.
  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", loyalty.organization_id)
    .eq("user_id", ctx.user.id)
    .eq("status", "active")
    .maybeSingle();
  const isOwnVendor = Boolean(membership);

  const balance = account?.point_balance ?? 0;
  const catalog = loyalty.catalog as LoyaltyCatalogPreviewItem[];
  const next = [...catalog]
    .filter((c) => c.points_cost > balance)
    .sort((a, b) => a.points_cost - b.points_cost)[0];

  return (
    <AuthenticatedAppShell>
      <div className="mx-auto max-w-md space-y-5">
        {isOwnVendor ? (
          <Alert>
            <Eye aria-hidden="true" />
            <AlertDescription>
              This is the customer&apos;s screen — what someone sees after
              scanning your printed code. To take payment and award points, use{" "}
              <Link href="/vendor/checkout" className="font-medium underline">
                Checkout
              </Link>
              .
            </AlertDescription>
          </Alert>
        ) : null}

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {loyalty.organization_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {balance > 0
              ? `${formatPoints(balance)} · earning ${loyalty.points_per_dollar} points per $1 spent.`
              : `Earn ${loyalty.points_per_dollar} points per $1 you spend here.`}
          </p>
        </div>

        <CheckoutCodeCard
          vendor={{
            organizationId: loyalty.organization_id,
            organizationName: loyalty.organization_name,
            vendorUnitId: unit.id,
            pointsPerDollar: loyalty.points_per_dollar,
            nextRewardLabel: next
              ? rewardDisplayLabel(
                  next.reward_kind,
                  next.reward_name,
                  next.reward_value_cents,
                )
              : null,
            nextRewardPointsCost: next ? next.points_cost : null,
          }}
        />

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Rewards
          </p>
          <ul className="mt-1 space-y-2">
            {catalog.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>
                  {rewardDisplayLabel(
                    item.reward_kind,
                    item.reward_name,
                    item.reward_value_cents,
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatPoints(item.points_cost)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={profileHref}>
              <ArrowLeft aria-hidden="true" />
              Back to {unit.name}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/rewards">All my rewards</Link>
          </Button>
        </div>
      </div>
    </AuthenticatedAppShell>
  );
}
