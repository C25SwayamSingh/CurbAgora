"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  enrollMfaAction,
  verifyMfaEnrollmentAction,
  type MfaEnrollmentState,
} from "@/features/authentication/actions";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { SubmitButton } from "@/features/authentication/components/submit-button";

/**
 * TOTP enrollment: start enrollment, scan QR (or copy the secret), then
 * confirm with the first 6-digit code. All verification happens server-side.
 */
export function MfaEnrollment({ nextPath }: { nextPath?: string } = {}) {
  const [enrollment, setEnrollment] = React.useState<MfaEnrollmentState>();
  const [starting, setStarting] = React.useState(false);
  const [verifyState, verifyAction] = useActionState(
    verifyMfaEnrollmentAction,
    idleState,
  );

  async function startEnrollment() {
    setStarting(true);
    try {
      const result = await enrollMfaAction();
      setEnrollment(result);
    } finally {
      setStarting(false);
    }
  }

  if (!enrollment || enrollment.status !== "success") {
    return (
      <div className="space-y-3">
        {enrollment?.status === "error" ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{enrollment.message}</AlertDescription>
          </Alert>
        ) : null}
        <Button onClick={startEnrollment} disabled={starting}>
          <ShieldCheck aria-hidden="true" />
          {starting ? "Preparing…" : "Set up authenticator app"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Adds a 6-digit code from an app like Google Authenticator or 1Password
          as a second step when you sign in — so a stolen password alone is not
          enough to access your account.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Scan this QR code with your authenticator app.</li>
        <li>Enter the 6-digit code it shows to finish setup.</li>
      </ol>

      {enrollment.qrCode ? (
        <div className="flex justify-center rounded-lg border border-border bg-white p-4">
          {/* Supabase returns an otpauth QR as a data URL — use img, not next/image. */}
          <img
            src={enrollment.qrCode}
            alt="QR code for authenticator app enrollment"
            width={176}
            height={176}
          />
        </div>
      ) : null}

      {enrollment.secret ? (
        <p className="break-all text-xs text-muted-foreground">
          Can&apos;t scan? Enter this key manually:{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            {enrollment.secret}
          </code>
        </p>
      ) : null}

      <form action={verifyAction} className="space-y-3" noValidate>
        {verifyState.status === "error" && verifyState.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{verifyState.message}</AlertDescription>
          </Alert>
        ) : null}

        <input type="hidden" name="factorId" value={enrollment.factorId} />
        {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}

        <div className="space-y-2">
          <Label htmlFor="code">6-digit code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            aria-describedby="code-error"
            aria-invalid={Boolean(verifyState.fieldErrors?.code)}
          />
          <FieldError id="code-error" errors={verifyState.fieldErrors?.code} />
        </div>

        <SubmitButton pendingLabel="Verifying…">
          Confirm and enable
        </SubmitButton>
      </form>

      <p className="text-xs text-muted-foreground">
        Recovery: if you lose your authenticator device, use your password on a
        device where you are still signed in to remove the factor from Security
        settings, or contact support. Store the manual key somewhere safe as a
        backup.
      </p>
    </div>
  );
}
