"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction } from "@/features/authentication/actions";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { PasswordInput } from "@/features/authentication/components/password-input";
import { SubmitButton } from "@/features/authentication/components/submit-button";

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, idleState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          autoComplete="name"
          required
          aria-describedby="displayName-error"
          aria-invalid={Boolean(state.fieldErrors?.displayName)}
        />
        <FieldError
          id="displayName-error"
          errors={state.fieldErrors?.displayName}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby="email-error"
          aria-invalid={Boolean(state.fieldErrors?.email)}
        />
        <FieldError id="email-error" errors={state.fieldErrors?.email} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
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
          At least 10 characters. A short sentence works well.
        </p>
        <FieldError id="password-error" errors={state.fieldErrors?.password} />
      </div>

      <SubmitButton className="w-full" pendingLabel="Creating account…">
        Create account
      </SubmitButton>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
