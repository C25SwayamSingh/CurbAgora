"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, Store, UtensilsCrossed } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { chooseOnboardingPathAction } from "@/features/authentication/actions";
import { idleState } from "@/features/authentication/action-state";
import { SubmitButton } from "@/features/authentication/components/submit-button";

/**
 * First onboarding step: pick a starting path. Sets preferred_mode (UI only)
 * and routes into customer or vendor onboarding — not permanent authorization.
 */
export function OnboardingPathForm({
  initialPreferredMode,
}: {
  initialPreferredMode: "customer" | "vendor" | null;
}) {
  const [state, formAction] = useActionState(
    chooseOnboardingPathAction,
    idleState,
  );
  const [selected, setSelected] = React.useState<"customer" | "vendor" | null>(
    initialPreferredMode,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">What would you like to do first?</legend>

        <label
          className={cn(
            "flex cursor-pointer flex-col gap-2 rounded-xl border p-5 transition-colors",
            selected === "customer"
              ? "border-primary ring-2 ring-ring"
              : "border-border hover:bg-accent/50",
          )}
        >
          <input
            type="radio"
            name="preferredMode"
            value="customer"
            checked={selected === "customer"}
            onChange={() => setSelected("customer")}
            className="sr-only"
            required
          />
          <UtensilsCrossed className="size-6 text-brand" aria-hidden="true" />
          <span className="font-medium">Discover vendors</span>
          <span className="text-sm text-muted-foreground">
            Find food carts, trucks, and pop-ups near you.
          </span>
        </label>

        <label
          className={cn(
            "flex cursor-pointer flex-col gap-2 rounded-xl border p-5 transition-colors",
            selected === "vendor"
              ? "border-primary ring-2 ring-ring"
              : "border-border hover:bg-accent/50",
          )}
        >
          <input
            type="radio"
            name="preferredMode"
            value="vendor"
            checked={selected === "vendor"}
            onChange={() => setSelected("vendor")}
            className="sr-only"
          />
          <Store className="size-6 text-primary" aria-hidden="true" />
          <span className="font-medium">Set up my vendor business</span>
          <span className="text-sm text-muted-foreground">
            Create your organization after profile setup and two-factor
            authentication.
          </span>
        </label>
      </fieldset>

      <p className="text-sm text-muted-foreground">
        You can switch between customer and vendor interfaces anytime. Vendor
        access requires joining or creating an organization.
      </p>

      <SubmitButton className="w-full sm:w-auto" pendingLabel="Continuing…">
        Continue
      </SubmitButton>
    </form>
  );
}
