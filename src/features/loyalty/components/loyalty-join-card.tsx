import Link from "next/link";
import { QrCode, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LoyaltyCatalogPreviewItem } from "@/lib/supabase/database.types";
import { formatPoints, rewardDisplayLabel } from "@/features/loyalty/engine";

/**
 * Rewards teaser on a vendor's public profile — the page the cart's printed QR
 * lands on. It advertises the program and hands off to the checkout screen;
 * it never mints a code itself, so a server component is enough.
 */
export function LoyaltyJoinCard({
  orgSlug,
  unitSlug,
  pointsPerDollar,
  catalog,
  earningPaused,
}: {
  orgSlug: string;
  unitSlug: string;
  pointsPerDollar: number;
  catalog: LoyaltyCatalogPreviewItem[];
  earningPaused: boolean;
}) {
  const entry = [...catalog].sort((a, b) => a.points_cost - b.points_cost)[0];

  return (
    <div className="mt-6 rounded-lg border border-secondary/40 bg-accent/40 p-4">
      <p className="flex items-center gap-1.5 text-sm font-medium text-brand">
        <Sparkles className="size-4" aria-hidden="true" />
        Rewards
      </p>
      <p className="mt-1 text-sm">
        Earn {pointsPerDollar} points per $1 you spend here.
        {entry
          ? ` ${formatPoints(entry.points_cost)} gets you ${rewardDisplayLabel(
              entry.reward_kind,
              entry.reward_name,
              entry.reward_value_cents,
            )}.`
          : ""}
      </p>

      <div className="mt-3">
        {earningPaused ? (
          <p className="text-sm text-muted-foreground">
            Earning is paused right now.
          </p>
        ) : (
          <Button asChild size="sm">
            <Link href={`/vendors/${orgSlug}/${unitSlug}/rewards`}>
              <QrCode aria-hidden="true" />
              Show my checkout code
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
