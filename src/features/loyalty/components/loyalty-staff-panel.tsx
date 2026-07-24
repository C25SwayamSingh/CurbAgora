"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Gift, QrCode } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { confirmLoyaltyRedemptionAction } from "@/features/loyalty/actions";

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
 * Rewards-page counter panel. Earning now lives on its own fast screen at
 * /vendor/checkout — it is the thing staff do dozens of times a shift and
 * shouldn't require loading a dashboard. Redemption keeps its own 6-character
 * code and stays here, unchanged.
 */
export function LoyaltyStaffPanel() {
  const [redeemState, redeemAction] = useActionState(
    confirmLoyaltyRedemptionAction,
    idleState,
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <QrCode className="size-5 text-brand" aria-hidden="true" />
            Award points
          </CardTitle>
          <CardDescription>
            Scan the customer&apos;s QR or enter their 4-digit code, then type
            the eligible subtotal from your register. The server turns that
            verified amount into points — customers can never enter it
            themselves.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/vendor/checkout">
              <QrCode aria-hidden="true" />
              Open checkout
            </Link>
          </Button>
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
