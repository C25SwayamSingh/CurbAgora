"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { idleState } from "@/features/authentication/action-state";
import { setLoyaltyPausedAction } from "@/features/loyalty/actions";

/**
 * Owner/manager control to pause new points and/or redemptions. Pausing never
 * erases earned progress — it only stops new activity — so each toggle is a
 * one-click form that flips a single flag and keeps the other as-is.
 */
export function LoyaltyPauseControl({
  earningPaused,
  redemptionPaused,
}: {
  earningPaused: boolean;
  redemptionPaused: boolean;
}) {
  const [state, formAction] = useActionState(setLoyaltyPausedAction, idleState);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <form action={formAction}>
          <input
            type="hidden"
            name="earningPaused"
            value={String(!earningPaused)}
          />
          <input
            type="hidden"
            name="redemptionPaused"
            value={String(redemptionPaused)}
          />
          <Button type="submit" variant="outline" size="sm">
            {earningPaused ? "Resume earning" : "Pause earning"}
          </Button>
        </form>
        <form action={formAction}>
          <input
            type="hidden"
            name="earningPaused"
            value={String(earningPaused)}
          />
          <input
            type="hidden"
            name="redemptionPaused"
            value={String(!redemptionPaused)}
          />
          <Button type="submit" variant="outline" size="sm">
            {redemptionPaused ? "Resume redemptions" : "Pause redemptions"}
          </Button>
        </form>
      </div>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === "success" && state.message ? (
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
