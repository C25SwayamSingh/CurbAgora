import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Sparkles } from "lucide-react";

import { AuthenticatedAppShell } from "@/components/app/authenticated-app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { pageTitle } from "@/lib/app-config";
import { requireCustomer } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import {
  LoyaltyPointsCard,
  type PointsCardData,
} from "@/features/loyalty/components/loyalty-points-card";

export const metadata: Metadata = { title: pageTitle("My rewards") };

export default async function RewardsPage() {
  const ctx = await requireCustomer("/rewards");
  const supabase = await createServerClient();

  // RLS scopes accounts to the signed-in customer.
  const { data: accounts } = await supabase
    .from("loyalty_accounts")
    .select("*")
    .eq("user_id", ctx.user.id)
    .order("updated_at", { ascending: false });

  const orgIds = (accounts ?? []).map((a) => a.organization_id);

  const { data: previews } = orgIds.length
    ? await supabase
        .from("loyalty_program_previews")
        .select("*")
        .in("organization_id", orgIds)
    : { data: [] };

  const previewByOrg = new Map(
    (previews ?? []).map((p) => [p.organization_id, p]),
  );

  const cards: PointsCardData[] = (accounts ?? [])
    .map((account): PointsCardData | null => {
      const preview = previewByOrg.get(account.organization_id);
      if (!preview) return null; // program archived/unpublished — hide the card
      return {
        organizationId: account.organization_id,
        organizationName: preview.organization_name,
        pointBalance: account.point_balance,
        pointsPerDollar: preview.points_per_dollar,
        catalog: preview.catalog,
        earningPaused: preview.earning_paused,
        redemptionPaused: preview.redemption_paused,
      };
    })
    .filter((c): c is PointsCardData => c !== null);

  return (
    <AuthenticatedAppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My rewards</h1>
          <p className="text-sm text-muted-foreground">
            Your points with neighborhood vendors. Show your code at the counter
            to earn or redeem.
          </p>
        </div>

        {cards.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="size-5 text-brand" aria-hidden="true" />
                No cards yet
              </CardTitle>
              <CardDescription>
                Find a vendor with a rewards program and tap “Start earning
                points” on their page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/discover">
                  <MapPin aria-hidden="true" />
                  Find vendors near me
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((card) => (
              <LoyaltyPointsCard key={card.organizationId} card={card} />
            ))}
          </div>
        )}
      </div>
    </AuthenticatedAppShell>
  );
}
