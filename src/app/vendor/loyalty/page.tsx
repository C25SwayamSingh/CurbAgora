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
import {
  formatCents,
  formatPoints,
  rewardDisplayLabel,
} from "@/features/loyalty/engine";
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

  const [
    { data: program },
    { data: version },
    { data: statsRows },
    { data: catalog },
  ] = await Promise.all([
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
    supabase
      .from("loyalty_reward_catalog_items")
      .select("*")
      .eq("organization_id", organizationId)
      .order("points_cost"),
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
            A points card for your regulars — designed with the advisor,
            approved by you, and safe for your margins.
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
                      {version.points_per_dollar} points per $1 ·{" "}
                      {(catalog ?? []).length} reward
                      {(catalog ?? []).length === 1 ? "" : "s"}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {program?.earning_paused ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        <PauseCircle className="size-3" aria-hidden="true" />
                        Earning paused
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
                  Customers earn {version.points_per_dollar} points for every $1
                  of eligible spend, confirmed by your staff at the counter.
                </p>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Reward menu
                    {canManage ? (
                      <span className="ml-2 font-normal normal-case tracking-normal">
                        —{" "}
                        <a
                          href="#change-rewards"
                          className="text-brand underline"
                        >
                          change these below
                        </a>
                      </span>
                    ) : null}
                  </p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {(catalog ?? []).map((item) => (
                      <li key={item.id} className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-secondary/20 px-2 py-0.5 text-xs font-medium text-brand">
                          {formatPoints(item.points_cost)}
                        </span>
                        <span>
                          {rewardDisplayLabel(
                            item.reward_kind,
                            item.reward_name,
                            item.reward_value_cents,
                          )}
                          {item.reward_kind === "FREE_ITEM"
                            ? ` (menu value ${formatCents(item.reward_value_cents)})`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {stats ? (
                  <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-4 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">Members</dt>
                      <dd className="font-semibold">{stats.members}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Points issued
                      </dt>
                      <dd className="font-semibold">
                        {Number(stats.points_issued).toLocaleString("en-US")}
                      </dd>
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
                        If everyone cashed in
                      </dt>
                      <dd className="font-semibold">
                        {formatCents(Number(stats.estimated_liability_cents))}
                      </dd>
                    </div>
                  </dl>
                ) : null}

                <Alert>
                  <TrendingUp aria-hidden="true" />
                  <AlertDescription>
                    {/* Leading space inside the element, not between two
                        siblings — JSX discards the latter unpredictably
                        depending on where the formatter wraps the line. */}
                    <strong>If everyone cashed in</strong>
                    <span>
                      {" "}
                      is what the points people are holding would cost you in
                      food, all at once. It won&apos;t happen in one day, and
                      it&apos;s an estimate from your own reward costs — not a
                      bill.
                    </span>
                  </AlertDescription>
                </Alert>

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
              <Card id="change-rewards" className="scroll-mt-4">
                <CardHeader>
                  <CardTitle className="text-lg">Change your rewards</CardTitle>
                  <CardDescription>
                    Add a reward, drop one, or change what they cost. Your
                    customers keep every point they&apos;ve already earned.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <LoyaltyConsultation
                    organizationId={organizationId}
                    hasActiveProgram
                    aiEnabled={advisorChatEnabled}
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
              aiEnabled={advisorChatEnabled}
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
