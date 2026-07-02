"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "@/features/authentication/actions";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { PasswordInput } from "@/features/authentication/components/password-input";
import { SubmitButton } from "@/features/authentication/components/submit-button";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(resetPasswordAction, idleState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={10}
          aria-describedby="password-error"
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
        <FieldError id="password-error" errors={state.fieldErrors?.password} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          required
          aria-describedby="confirmPassword-error"
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
        />
        <FieldError
          id="confirmPassword-error"
          errors={state.fieldErrors?.confirmPassword}
        />
      </div>

      <SubmitButton className="w-full" pendingLabel="Updating password…">
        Update password
      </SubmitButton>
    </form>
  );
}
