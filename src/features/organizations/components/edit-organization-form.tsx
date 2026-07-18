"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { SubmitButton } from "@/features/authentication/components/submit-button";
import { updateOrganizationAction } from "@/features/organizations/actions";
import type { Organization } from "@/lib/supabase/database.types";

export function EditOrganizationForm({
  organization,
}: {
  organization: Organization;
}) {
  const [state, formAction] = useActionState(
    updateOrganizationAction,
    idleState,
  );
  const [slug, setSlug] = React.useState(organization.slug);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === "success" ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="displayName">Business name</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={organization.display_name}
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
        <Label htmlFor="legalName">Legal name</Label>
        <Input
          id="legalName"
          name="legalName"
          defaultValue={organization.legal_name}
          required
          aria-describedby="legalName-error legalName-hint"
          aria-invalid={Boolean(state.fieldErrors?.legalName)}
        />
        <p id="legalName-hint" className="text-xs text-muted-foreground">
          The registered name of your business, if different.
        </p>
        <FieldError
          id="legalName-error"
          errors={state.fieldErrors?.legalName}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug">URL name</Label>
        <Input
          id="slug"
          name="slug"
          value={slug}
          onChange={(event) => setSlug(event.target.value.toLowerCase())}
          required
          aria-describedby="slug-error slug-hint"
          aria-invalid={Boolean(state.fieldErrors?.slug)}
        />
        <p id="slug-hint" className="text-xs text-muted-foreground">
          Lowercase letters, numbers, and hyphens. Changing this changes the
          link to every one of your vendor units&apos; public pages.
        </p>
        <FieldError id="slug-error" errors={state.fieldErrors?.slug} />
      </div>

      <SubmitButton className="w-full sm:w-auto" pendingLabel="Saving…">
        Save changes
      </SubmitButton>
    </form>
  );
}
