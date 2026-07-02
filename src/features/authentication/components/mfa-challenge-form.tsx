"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mfaChallengeAction } from "@/features/authentication/actions";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { SubmitButton } from "@/features/authentication/components/submit-button";

export function MfaChallengeForm({ nextPath }: { nextPath?: string }) {
  const [state, formAction] = useActionState(mfaChallengeAction, idleState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

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
          autoFocus
          aria-describedby="code-error"
          aria-invalid={Boolean(state.fieldErrors?.code)}
        />
        <FieldError id="code-error" errors={state.fieldErrors?.code} />
      </div>

      <SubmitButton className="w-full" pendingLabel="Verifying…">
        Verify
      </SubmitButton>
    </form>
  );
}
