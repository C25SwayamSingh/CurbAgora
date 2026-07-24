"use client";

import * as React from "react";
import { Gift, Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { LoyaltyCatalogPreviewItem } from "@/lib/supabase/database.types";
import {
  requestLoyaltyRedemption,
  type LoyaltyCodeResult,
} from "@/features/loyalty/actions";
import { CheckoutCodeCard } from "@/features/loyalty/components/checkout-code-card";
import {
  formatCents,
  formatPoints,
  rewardDisplayLabel,
} from "@/features/loyalty/engine";
import {
  formatCountdown,
  useCountdown,
} from "@/features/loyalty/use-countdown";

export type PointsCardData = {
  organizationId: string;
  organizationName: string;
  pointBalance: number;
  pointsPerDollar: number;
  catalog: LoyaltyCatalogPreviewItem[];
  earningPaused: boolean;
  redemptionPaused: boolean;
};

/** Cheapest reward the customer cannot yet afford — their next goal. */
function nextReward(card: PointsCardData): LoyaltyCatalogPreviewItem | null {
  const upcoming = card.catalog
    .filter((c) => c.points_cost > card.pointBalance)
    .sort((a, b) => a.points_cost - b.points_cost);
  return upcoming[0] ?? null;
}

function rewardLabel(item: LoyaltyCatalogPreviewItem): string {
  return rewardDisplayLabel(
    item.reward_kind,
    item.reward_name,
    item.reward_value_cents,
  );
}

/**
 * A customer's points wallet for one vendor. Progress is read-only; both
 * actions request a short-lived, single-use code from the server — the
 * customer never awards themselves value, and never enters a purchase amount.
 */
export function LoyaltyPointsCard({ card }: { card: PointsCardData }) {
  const [pending, setPending] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<{
    value: string;
    expiresAt: string;
    label?: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const remaining = useCountdown(code?.expiresAt ?? null);
  const codeExpired = code !== null && remaining === 0;
  const next = nextReward(card);
  const affordable = card.catalog.filter(
    (c) => c.points_cost <= card.pointBalance,
  );

  async function redeem(item: LoyaltyCatalogPreviewItem) {
    setError(null);
    setCode(null);
    setPending(item.id);
    let result: LoyaltyCodeResult;
    try {
      result = await requestLoyaltyRedemption(card.organizationId, item.id);
    } finally {
      setPending(null);
    }
    if (result.ok) {
      setCode({
        value: result.code,
        expiresAt: result.expiresAt,
        label: result.rewardName,
      });
    } else {
      setError(result.message);
    }
  }

  // Spend still needed for the next reward, from the points gap.
  const pointsToNext = next ? next.points_cost - card.pointBalance : 0;
  const spendToNextCents =
    next && card.pointsPerDollar > 0
      ? Math.ceil((pointsToNext * 100) / card.pointsPerDollar)
      : 0;
  const progressPct = next
    ? Math.min(100, Math.floor((card.pointBalance * 100) / next.points_cost))
    : 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{card.organizationName}</CardTitle>
        <CardDescription>
          {next
            ? `${formatPoints(pointsToNext)} until ${rewardLabel(next)} — about ${formatCents(spendToNextCents)} more.`
            : affordable.length > 0
              ? "You have enough points to redeem a reward."
              : "Earn points on every visit."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-3xl font-bold tracking-tight">
            {card.pointBalance.toLocaleString("en-US")}
            <span className="ml-1 text-base font-normal text-muted-foreground">
              points
            </span>
          </p>
          {next ? (
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progress to ${rewardLabel(next)}`}
            >
              <div
                className="h-full rounded-full bg-secondary"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            Earning {card.pointsPerDollar} points per $1 spent.
          </p>
        </div>

        {card.earningPaused ? (
          <Alert>
            <AlertDescription>
              This vendor has paused earning for now. Your points are safe.
            </AlertDescription>
          </Alert>
        ) : (
          <CheckoutCodeCard
            vendor={{
              organizationId: card.organizationId,
              organizationName: card.organizationName,
              pointsPerDollar: card.pointsPerDollar,
              nextRewardLabel: next ? rewardLabel(next) : null,
              nextRewardPointsCost: next ? next.points_cost : null,
            }}
          />
        )}

        {code && !codeExpired ? (
          <div className="rounded-lg border border-secondary bg-accent/40 p-4 text-center">
            <p className="text-xs text-muted-foreground">
              {`Show this to staff to redeem ${code.label}`}
            </p>
            <p className="my-1 font-mono text-3xl font-bold tracking-widest">
              {code.value}
            </p>
            <p className="text-xs text-muted-foreground">
              Expires in {remaining !== null ? formatCountdown(remaining) : "—"}
            </p>
          </div>
        ) : null}

        {codeExpired ? (
          <Alert>
            <AlertDescription>
              That code expired. Request a new one when you&apos;re at the
              counter.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Rewards
          </p>
          <ul className="mt-1 space-y-2">
            {card.catalog.map((item) => {
              const canAfford = item.points_cost <= card.pointBalance;
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="text-sm">
                    {rewardLabel(item)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatPoints(item.points_cost)}
                    </span>
                  </span>
                  {canAfford ? (
                    <Button
                      size="sm"
                      onClick={() => redeem(item)}
                      disabled={pending !== null || card.redemptionPaused}
                    >
                      {pending === item.id ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Gift aria-hidden="true" />
                      )}
                      {card.redemptionPaused ? "Paused" : "Redeem"}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {formatPoints(item.points_cost - card.pointBalance)} to go
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
