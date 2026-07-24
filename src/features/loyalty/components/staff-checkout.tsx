"use client";

import * as React from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Keyboard,
  Loader2,
  QrCode,
  UserCheck,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrScanner } from "@/features/loyalty/components/qr-scanner";
import {
  awardPointsAction,
  resolveCheckoutSessionAction,
  type IdentifiedMember,
} from "@/features/loyalty/actions";
import {
  isValidNumericCode,
  normalizeNumericInput,
  parseSubtotalToCents,
  previewPoints,
} from "@/features/loyalty/checkout-code";
import { formatCents, formatPoints } from "@/features/loyalty/engine";

type Step =
  | { name: "identify" }
  | { name: "scan" }
  | { name: "code" }
  | { name: "subtotal"; member: IdentifiedMember }
  | { name: "done"; points: number; balance: number; name_: string | null };

/**
 * The counter screen, built for one person running a cart with a queue.
 *
 * Both identification methods are peers — neither is buried behind the other,
 * because which one is faster depends on the moment (a customer already
 * holding up a phone vs. one still digging for it). The whole interaction is
 * three actions: identify, type the register amount, confirm.
 */
export function StaffCheckout({
  pointsPerDollar,
}: {
  pointsPerDollar: number;
}) {
  const [step, setStep] = React.useState<Step>({ name: "identify" });
  const [code, setCode] = React.useState("");
  const [subtotal, setSubtotal] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const codeRef = React.useRef<HTMLInputElement | null>(null);
  const subtotalRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (step.name === "code") codeRef.current?.focus();
    if (step.name === "subtotal") subtotalRef.current?.focus();
  }, [step.name]);

  function reset() {
    setStep({ name: "identify" });
    setCode("");
    setSubtotal("");
    setError(null);
  }

  async function identify(method: "qr" | "code4", value: string) {
    setError(null);
    setPending(true);
    try {
      const result = await resolveCheckoutSessionAction(method, value);
      if (result.ok) {
        setStep({ name: "subtotal", member: result.member });
        setCode("");
      } else {
        setError(result.message);
        // Keep the vendor on the method they chose so a mistyped digit is one
        // correction away, not a restart.
        if (method === "qr") setStep({ name: "identify" });
      }
    } finally {
      setPending(false);
    }
  }

  async function award(member: IdentifiedMember) {
    setError(null);
    setPending(true);
    try {
      const result = await awardPointsAction(member.sessionId, subtotal);
      if (result.ok) {
        setStep({
          name: "done",
          points: result.pointsAwarded,
          balance: result.pointBalance,
          name_: member.displayName,
        });
        setSubtotal("");
      } else {
        setError(result.message);
      }
    } finally {
      setPending(false);
    }
  }

  /* ---------------------------------------------------------------- */

  if (step.name === "done") {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <CheckCircle2
          className="mx-auto size-10 text-success"
          aria-hidden="true"
        />
        <p className="mt-3 text-2xl font-bold tracking-tight">
          {formatPoints(step.points)} awarded
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {step.name_ ? `${step.name_} now has ` : "New balance: "}
          {formatPoints(step.balance)}
        </p>
        <Button className="mt-5 h-14 w-full text-base" onClick={reset}>
          Next customer
        </Button>
      </div>
    );
  }

  if (step.name === "subtotal") {
    const cents = parseSubtotalToCents(subtotal);
    const preview = cents ? previewPoints(cents, pointsPerDollar) : 0;

    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-secondary bg-accent/40 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-brand">
            <UserCheck className="size-4" aria-hidden="true" />
            Customer identified
          </p>
          <p className="mt-1 text-lg font-semibold">
            {step.member.displayName ?? "Member"}
          </p>
          <p className="text-xs text-muted-foreground">
            Member {step.member.memberRef} ·{" "}
            {formatPoints(step.member.pointBalance)} balance
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void award(step.member);
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="checkout-subtotal">Enter eligible subtotal</Label>
            <Input
              id="checkout-subtotal"
              ref={subtotalRef}
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="12.50"
              className="h-14 text-2xl"
            />
            <p className="text-xs text-muted-foreground">
              Enter the amount before tax, tip, and fees.
            </p>
          </div>

          {preview > 0 ? (
            <p className="text-sm font-medium">
              {formatCents(cents!)} → {formatPoints(preview)}
            </p>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="submit"
            className="h-14 w-full text-base"
            disabled={pending || preview <= 0}
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : null}
            Award points
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={reset}
          >
            <ArrowLeft aria-hidden="true" />
            Cancel
          </Button>
        </form>
      </div>
    );
  }

  if (step.name === "scan") {
    return (
      <div className="space-y-4">
        <QrScanner
          onToken={(token) => void identify("qr", token)}
          onCancel={() => setStep({ name: "identify" })}
        />
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {/* The spoken code stays one tap away no matter what the camera does. */}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setStep({ name: "code" })}
        >
          <Keyboard aria-hidden="true" />
          Enter 4-digit code instead
        </Button>
      </div>
    );
  }

  if (step.name === "code") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void identify("code4", code);
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="checkout-code">Enter 4-digit code</Label>
          <Input
            id="checkout-code"
            ref={codeRef}
            value={code}
            onChange={(e) => setCode(normalizeNumericInput(e.target.value))}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={4}
            placeholder="0000"
            className="h-16 text-center font-mono text-4xl tracking-[0.3em]"
          />
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button
          type="submit"
          className="h-14 w-full text-base"
          disabled={pending || !isValidNumericCode(code)}
        >
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : null}
          Find customer
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => {
            setCode("");
            setError(null);
            setStep({ name: "identify" });
          }}
        >
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Ask the customer to open their checkout code, then scan it or type the
        four digits they read out.
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        className="h-16 w-full text-base"
        onClick={() => {
          setError(null);
          setStep({ name: "scan" });
        }}
      >
        <QrCode aria-hidden="true" />
        Scan customer QR
      </Button>
      <Button
        variant="secondary"
        className="h-16 w-full text-base"
        onClick={() => {
          setError(null);
          setStep({ name: "code" });
        }}
      >
        <Keyboard aria-hidden="true" />
        Enter 4-digit code
      </Button>
    </div>
  );
}
