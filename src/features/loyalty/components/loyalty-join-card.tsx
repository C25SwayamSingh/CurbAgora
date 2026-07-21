"use client";

import * as React from "react";
import { Loader2, Stamp } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createLoyaltyClaimCode } from "@/features/loyalty/actions";

/**
 * Public-profile entry point for starting a stamp card with a vendor. Getting
 * a code creates the customer's account (server-side, upsert) and returns a
 * short-lived code to show staff. Unauthenticated visitors are redirected to
 * sign in by the action's requireAuth guard.
 */
export function LoyaltyJoinCard({
  organizationId,
  stampsRequired,
  rewardName,
  qualifyingMinCents,
  earningPaused,
}: {
  organizationId: string;
  stampsRequired: number;
  rewardName: string;
  qualifyingMinCents: number;
  earningPaused: boolean;
}) {
  const [pending, setPending] = React.useState(false);
  const [code, setCode] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function start() {
    setError(null);
    setPending(true);
    try {
      const result = await createLoyaltyClaimCode(organizationId);
      if (result.ok) {
        setCode(result.code);
      } else {
        setError(result.message);
      }
    } finally {
      setPending(false);
    }
  }

  const dollars = (qualifyingMinCents / 100).toFixed(
    qualifyingMinCents % 100 === 0 ? 0 : 2,
  );

  return (
    <div className="mt-6 rounded-lg border border-secondary/40 bg-accent/40 p-4">
      <p className="flex items-center gap-1.5 text-sm font-medium text-brand">
        <Stamp className="size-4" aria-hidden="true" />
        Loyalty stamp card
      </p>
      <p className="mt-1 text-sm">
        Collect {stampsRequired} stamps — one per visit with a purchase of at
        least ${dollars} — and unlock a free {rewardName}.
      </p>

      {code ? (
        <div className="mt-3 rounded-md border border-secondary bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">
            Show this code to staff to add your stamp
          </p>
          <p className="my-1 font-mono text-2xl font-bold tracking-widest">
            {code}
          </p>
          <p className="text-xs text-muted-foreground">
            Expires in 10 minutes · manage cards under My rewards
          </p>
        </div>
      ) : (
        <div className="mt-3">
          {error ? (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button size="sm" onClick={start} disabled={pending || earningPaused}>
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Stamp aria-hidden="true" />
            )}
            {earningPaused ? "Stamps paused" : "Start your stamp card"}
          </Button>
        </div>
      )}
    </div>
  );
}
