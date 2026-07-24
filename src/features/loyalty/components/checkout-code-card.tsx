"use client";

import * as React from "react";
import {
  CheckCircle2,
  Loader2,
  QrCode as QrIcon,
  RefreshCw,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { QrCode } from "@/features/loyalty/components/qr-code";
import {
  cancelCheckoutSessionAction,
  getCheckoutStatusAction,
  startCheckoutSessionAction,
  type CheckoutSession,
} from "@/features/loyalty/actions";
import { formatCents, formatPoints } from "@/features/loyalty/engine";
import {
  formatCountdown,
  useCountdown,
} from "@/features/loyalty/use-countdown";

const POLL_INTERVAL_MS = 3000;

export type CheckoutVendor = {
  organizationId: string;
  organizationName: string;
  vendorUnitId?: string | null;
  pointsPerDollar: number;
  /** Cheapest reward still out of reach, for the "what's next" line. */
  nextRewardLabel: string | null;
  nextRewardPointsCost: number | null;
};

type Awarded = { points: number; balance: number };

/**
 * The customer's temporary checkout identity: one QR and one 4-digit code,
 * both pointing at the same session. Staff may use whichever is faster.
 *
 * Nothing here can grant value. The screen shows who the customer is; the
 * amount comes from the vendor's register, entered by staff.
 */
export function CheckoutCodeCard({ vendor }: { vendor: CheckoutVendor }) {
  const [session, setSession] = React.useState<CheckoutSession | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [awarded, setAwarded] = React.useState<Awarded | null>(null);

  const remaining = useCountdown(awarded ? null : (session?.expiresAt ?? null));
  const expired = session !== null && !awarded && remaining === 0;

  const open = React.useCallback(async () => {
    setError(null);
    setAwarded(null);
    setPending(true);
    try {
      const result = await startCheckoutSessionAction(
        vendor.organizationId,
        vendor.vendorUnitId ?? null,
      );
      if (result.ok) {
        setSession(result.session);
      } else {
        setError(result.message);
      }
    } finally {
      setPending(false);
    }
  }, [vendor.organizationId, vendor.vendorUnitId]);

  async function refresh() {
    if (session) await cancelCheckoutSessionAction(session.sessionId);
    setSession(null);
    await open();
  }

  // Watch our own session so the confirmation appears without the customer
  // needing to do anything while staff finishes at the register.
  React.useEffect(() => {
    if (!session || awarded || expired) return;
    let cancelled = false;
    const id = setInterval(async () => {
      const status = await getCheckoutStatusAction(session.sessionId);
      if (cancelled || !status) return;
      if (status.status === "confirmed") {
        setAwarded({
          points: status.pointsAwarded,
          balance: status.pointBalance,
        });
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session, awarded, expired]);

  if (awarded) {
    const toNext =
      vendor.nextRewardPointsCost !== null
        ? vendor.nextRewardPointsCost - awarded.balance
        : null;
    const spendToNext =
      toNext !== null && toNext > 0 && vendor.pointsPerDollar > 0
        ? Math.ceil((toNext * 100) / vendor.pointsPerDollar)
        : null;

    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <CheckCircle2
          className="mx-auto size-10 text-success"
          aria-hidden="true"
        />
        <p className="mt-3 text-2xl font-bold tracking-tight">
          {formatPoints(awarded.points)} earned
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          at {vendor.organizationName}
        </p>
        <p className="mt-4 text-lg font-semibold">
          New balance: {formatPoints(awarded.balance)}
        </p>
        {toNext !== null && toNext > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {formatPoints(toNext)} until {vendor.nextRewardLabel}
            {spendToNext ? ` — about ${formatCents(spendToNext)} more` : ""}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            You have enough points to redeem a reward.
          </p>
        )}
        <Button
          className="mt-5 w-full"
          onClick={() => {
            // Both must clear: the consumed session is spent, and leaving
            // `awarded` set would keep re-rendering this same screen.
            setAwarded(null);
            setSession(null);
          }}
        >
          Done
        </Button>
      </div>
    );
  }

  if (!session || expired) {
    return (
      <div className="space-y-3">
        {expired ? (
          <Alert>
            <AlertDescription>
              That code expired. Show a new one when you&apos;re at the counter.
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button className="w-full" onClick={open} disabled={pending} size="lg">
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <QrIcon aria-hidden="true" />
          )}
          Show my checkout code
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 text-center shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-brand">
        Your code
      </p>
      <p className="mt-1 text-sm font-medium">
        Hold this up at {vendor.organizationName}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Show it to the person taking your payment, before you pay. They scan it
        or type the four digits.
      </p>

      <div className="mx-auto mt-4 w-full max-w-[15rem] rounded-lg bg-white p-3">
        <QrCode
          value={session.qrPayload}
          label={`Checkout code for ${vendor.organizationName}`}
        />
      </div>

      <p
        className="mt-4 font-mono text-5xl font-bold tracking-[0.2em] tabular-nums"
        aria-label={`Four digit code ${session.numericCode.split("").join(" ")}`}
      >
        {session.numericCode}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Or just read these four digits out loud
      </p>

      <p className="mt-3 text-sm font-medium text-live" aria-live="polite">
        Expires in {remaining !== null ? formatCountdown(remaining) : "—"}
      </p>

      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={refresh}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw aria-hidden="true" />
        )}
        Refresh code
      </Button>
    </div>
  );
}
