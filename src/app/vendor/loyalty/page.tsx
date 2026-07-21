import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, PauseCircle, TrendingUp } from "lucide-react";

import { AuthenticatedAppShell } from "@/components/app/authenticated-app-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { formatCents } from "@/features/loyalty/engine";
import { isLoyaltyConsultantConfigured } from "@/features/loyalty/consultant";
import { LoyaltyAdvisorChat } from "@/features/loyalty/components/loyalty-advisor-chat";
import { LoyaltyConsultation } from "@/features/loyalty/components/loyalty-consultation";
import { LoyaltyPauseControl } from "@/features/loyalty/components/loyalty-pause-control";
import { LoyaltyStaffPanel } from "@/features/loyalty/components/loyalty-staff-panel";

export const metadata: Metadata = { title: pageTitle("Loyalty & rewards") };

export default async function VendorLoyaltyPage() {
  const ctx = await requireVendorMember(undefined, "/vendor/loyalty");
  const organizationId = ctx.membership.organization_id;
  const canManage =
    ctx.membership.role === "owner" || ctx.membership.role === "manager";

  const supabase = await createServerClient();

  const [{ data: program }, { data: version }, { data: statsRows }] =
    await Promise.all([
      supabase
        .from("loyalty_programs")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabase
        .from("loyalty_program_versions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .maybeSingle(),
      supabase.rpc("loyalty_program_stats", {
        p_organization_id: organizationId,
      }),
    ]);

  const stats = statsRows?.[0];
  const hasActiveProgram = Boolean(version);
  const advisorChatEnabled = canManage && isLoyaltyConsultantConfigured();

  return (
    <AuthenticatedAppShell>
      <div className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link href="/vendor">
              <ArrowLeft aria-hidden="true" />
              Vendor dashboard
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            Loyalty &amp; rewards
          </h1>
          <p className="text-sm text-muted-foreground">
            A neighborhood stamp card for your regulars — designed with the
            advisor, approved by you, and safe for your margins.
          </p>
        </div>

        {hasActiveProgram && version ? (
          <>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg">Live program</CardTitle>
                    <CardDescription>
                      {version.stamps_required}-stamp card · reward:{" "}
                      {version.reward_name}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {program?.earning_paused ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        <PauseCircle className="size-3" aria-hidden="true" />
                        Stamps paused
                      </span>
                    ) : (
                      <span className="rounded-full bg-live/15 px-2 py-0.5 text-xs font-medium text-live">
                        Earning live
                      </span>
                    )}
                    {program?.redemption_paused ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        <PauseCircle className="size-3" aria-hidden="true" />
                        Redemptions paused
                      </span>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm">
                  One stamp per visit with an eligible purchase of at least{" "}
                  {formatCents(version.qualifying_min_cents)} (max one stamp per{" "}
                  {Math.round(version.stamp_period_minutes / 60)}h).{" "}
                  {version.stamps_required} stamps unlock a free{" "}
                  {version.reward_name} (menu value{" "}
                  {formatCents(version.reward_retail_value_cents)}).
                </p>

                {stats ? (
                  <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-4 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">Members</dt>
                      <dd className="font-semibold">{stats.members}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Stamps issued
                      </dt>
                      <dd className="font-semibold">{stats.stamps_issued}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Rewards redeemed
                      </dt>
                      <dd className="font-semibold">
                        {stats.rewards_redeemed}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Est. outstanding liability
                      </dt>
                      <dd className="font-semibold">
                        {formatCents(Number(stats.estimated_liability_cents))}
                      </dd>
                    </div>
                  </dl>
                ) : null}

                {version.reward_est_cost_cents === null ? (
                  <Alert>
                    <TrendingUp aria-hidden="true" />
                    <AlertDescription>
                      Liability uses a 30%-of-menu-price cost estimate. Re-run
                      the advisor with your real reward cost for a precise
                      figure.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {canManage ? (
                  <LoyaltyPauseControl
                    earningPaused={Boolean(program?.earning_paused)}
                    redemptionPaused={Boolean(program?.redemption_paused)}
                  />
                ) : null}
              </CardContent>
            </Card>

            <div>
              <h2 className="text-lg font-semibold">At the counter</h2>
              <p className="text-sm text-muted-foreground">
                Confirm a customer&apos;s code after their purchase. Any staff
                member can do this.
              </p>
            </div>
            <LoyaltyStaffPanel />

            {advisorChatEnabled ? <LoyaltyAdvisorChat /> : null}

            {canManage ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Change the program</CardTitle>
                  <CardDescription>
                    Re-run the advisor to model and publish a new version.
                    Existing customers keep every stamp they&apos;ve earned.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <LoyaltyConsultation
                    organizationId={organizationId}
                    hasActiveProgram
                  />
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : canManage ? (
          <>
            <LoyaltyConsultation
              organizationId={organizationId}
              hasActiveProgram={false}
            />
            {advisorChatEnabled ? <LoyaltyAdvisorChat /> : null}
          </>
        ) : (
          <Alert>
            <AlertDescription>
              No loyalty program is published yet. An owner or manager can set
              one up with the advisor.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </AuthenticatedAppShell>
  );
}
