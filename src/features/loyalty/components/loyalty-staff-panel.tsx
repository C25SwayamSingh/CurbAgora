"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Gift, Stamp } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  idleState,
  type ActionState,
} from "@/features/authentication/action-state";
import { SubmitButton } from "@/features/authentication/components/submit-button";
import {
  confirmLoyaltyClaimAction,
  confirmLoyaltyRedemptionAction,
} from "@/features/loyalty/actions";

function Result({ state }: { state: ActionState }) {
  if (state.status === "error" && state.message) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  if (state.status === "success" && state.message) {
    return (
      <Alert>
        <CheckCircle2 aria-hidden="true" />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

/**
 * Counter panel any staff member uses to confirm a customer's short-lived
 * code. Stamps and redemptions are only ever applied by these staff-verified
 * codes — customers can never self-issue value.
 */
export function LoyaltyStaffPanel() {
  const [claimState, claimAction] = useActionState(
    confirmLoyaltyClaimAction,
    idleState,
  );
  const [redeemState, redeemAction] = useActionState(
    confirmLoyaltyRedemptionAction,
    idleState,
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Stamp className="size-5 text-brand" aria-hidden="true" />
            Add a stamp
          </CardTitle>
          <CardDescription>
            Enter the 6-character code from the customer&apos;s phone after an
            eligible purchase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={claimAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="claim-code">Stamp code</Label>
              <Input
                id="claim-code"
                name="code"
                autoComplete="off"
                inputMode="text"
                maxLength={6}
                placeholder="ABC123"
                className="font-mono uppercase tracking-widest"
              />
            </div>
            <Result state={claimState} />
            <SubmitButton pendingLabel="Confirming…">
              Confirm stamp
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gift className="size-5 text-live" aria-hidden="true" />
            Redeem a reward
          </CardTitle>
          <CardDescription>
            Enter the redemption code the customer shows once their card is
            full, then hand over the reward.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={redeemAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="redeem-code">Redemption code</Label>
              <Input
                id="redeem-code"
                name="code"
                autoComplete="off"
                inputMode="text"
                maxLength={6}
                placeholder="XYZ789"
                className="font-mono uppercase tracking-widest"
              />
            </div>
            <Result state={redeemState} />
            <SubmitButton pendingLabel="Confirming…">
              Confirm redemption
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
