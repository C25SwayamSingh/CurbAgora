"use client";

import * as React from "react";
import { Gift, Loader2, Stamp } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  createLoyaltyClaimCode,
  requestLoyaltyRedemption,
  type LoyaltyCodeResult,
} from "@/features/loyalty/actions";

export type StampCardData = {
  organizationId: string;
  organizationName: string;
  stampBalance: number;
  stampsRequired: number;
  rewardName: string;
  earningPaused: boolean;
  redemptionPaused: boolean;
};

function useCountdown(expiresAt: string | null): number | null {
  // A ticking `now` drives the countdown; `remaining` is derived during
  // render so the effect never calls setState synchronously.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * A customer's visual stamp card for one vendor. Progress is read-only; the
 * two actions each request a short-lived, single-use code from the server —
 * the customer never awards themselves value. Staff confirm the code at the
 * counter.
 */
export function LoyaltyStampCard({ card }: { card: StampCardData }) {
  const complete = card.stampBalance >= card.stampsRequired;
  const [pending, setPending] = React.useState<"stamp" | "reward" | null>(null);
  const [code, setCode] = React.useState<{
    kind: "stamp" | "reward";
    value: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const remaining = useCountdown(code?.expiresAt ?? null);
  const codeExpired = code !== null && remaining === 0;

  async function requestCode(kind: "stamp" | "reward") {
    setError(null);
    setCode(null);
    setPending(kind === "stamp" ? "stamp" : "reward");
    let result: LoyaltyCodeResult;
    try {
      result =
        kind === "stamp"
          ? await createLoyaltyClaimCode(card.organizationId)
          : await requestLoyaltyRedemption(card.organizationId);
    } finally {
      setPending(null);
    }
    if (result.ok) {
      setCode({ kind, value: result.code, expiresAt: result.expiresAt });
    } else {
      setError(result.message);
    }
  }

  const dots = Array.from({ length: card.stampsRequired }, (_, i) => i);
  const remainingStamps = Math.max(0, card.stampsRequired - card.stampBalance);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{card.organizationName}</CardTitle>
        <CardDescription>
          {complete
            ? `Card full — redeem your free ${card.rewardName}!`
            : remainingStamps === 1
              ? `One more stamp until your free ${card.rewardName}.`
              : `${remainingStamps} more stamps until your free ${card.rewardName}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="flex flex-wrap gap-2"
          role="img"
          aria-label={`${card.stampBalance} of ${card.stampsRequired} stamps`}
        >
          {dots.map((i) => {
            const filled = i < card.stampBalance;
            return (
              <span
                key={i}
                aria-hidden="true"
                className={
                  "flex size-9 items-center justify-center rounded-full border text-xs font-semibold " +
                  (filled
                    ? "border-secondary bg-secondary text-secondary-foreground"
                    : "border-dashed border-border text-muted-foreground")
                }
              >
                {filled ? <Stamp className="size-4" /> : i + 1}
              </span>
            );
          })}
        </div>

        <p className="text-sm text-muted-foreground">
          {card.stampBalance} of {card.stampsRequired} stamps
        </p>

        {code && !codeExpired ? (
          <div className="rounded-lg border border-secondary bg-accent/40 p-4 text-center">
            <p className="text-xs text-muted-foreground">
              {code.kind === "stamp"
                ? "Show this to staff to add your stamp"
                : "Show this to staff to redeem your reward"}
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

        <div className="flex flex-wrap gap-2">
          {complete ? (
            <Button
              onClick={() => requestCode("reward")}
              disabled={pending !== null || card.redemptionPaused}
            >
              {pending === "reward" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Gift aria-hidden="true" />
              )}
              {card.redemptionPaused ? "Redemptions paused" : "Redeem reward"}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => requestCode("stamp")}
              disabled={pending !== null || card.earningPaused}
            >
              {pending === "stamp" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Stamp aria-hidden="true" />
              )}
              {card.earningPaused ? "Stamps paused" : "Show stamp code"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
