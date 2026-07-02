"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeCustomerOnboardingAction } from "@/features/authentication/actions";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { SubmitButton } from "@/features/authentication/components/submit-button";

export function CustomerOnboardingForm({
  initialDisplayName,
}: {
  initialDisplayName: string;
}) {
  const [state, formAction] = useActionState(
    completeCustomerOnboardingAction,
    idleState,
  );

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
          defaultValue={initialDisplayName}
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
        <Label htmlFor="avatarUrl">Avatar URL (optional)</Label>
        <Input
          id="avatarUrl"
          name="avatarUrl"
          type="url"
          placeholder="https://…"
          aria-describedby="avatarUrl-error"
          aria-invalid={Boolean(state.fieldErrors?.avatarUrl)}
        />
        <FieldError
          id="avatarUrl-error"
          errors={state.fieldErrors?.avatarUrl}
        />
      </div>

      <SubmitButton className="w-full sm:w-auto" pendingLabel="Finishing up…">
        Finish and go to my dashboard
      </SubmitButton>
    </form>
  );
}
