"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "@/features/authentication/actions";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { PasswordInput } from "@/features/authentication/components/password-input";
import { SubmitButton } from "@/features/authentication/components/submit-button";

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, idleState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === "success" && state.message ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="currentPassword">Current password</Label>
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          required
          aria-describedby="currentPassword-error"
          aria-invalid={Boolean(state.fieldErrors?.currentPassword)}
        />
        <FieldError
          id="currentPassword-error"
          errors={state.fieldErrors?.currentPassword}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={10}
          aria-describedby="password-error password-hint"
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          At least 10 characters.
        </p>
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

      <SubmitButton pendingLabel="Updating…">Update password</SubmitButton>

      <p className="text-xs text-muted-foreground">
        Lost access? Use{" "}
        <Link
          href="/forgot-password"
          className="text-primary underline-offset-4 hover:underline"
        >
          password reset
        </Link>{" "}
        from the sign-in page.
      </p>
    </form>
  );
}
