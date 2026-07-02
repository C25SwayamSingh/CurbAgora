"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, Store, UtensilsCrossed } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { chooseAccountTypeAction } from "@/features/authentication/actions";
import { idleState } from "@/features/authentication/action-state";
import { SubmitButton } from "@/features/authentication/components/submit-button";

/**
 * One-time customer/vendor choice. This selects an onboarding path — it does
 * not grant any vendor data access by itself (that comes from organization
 * membership, enforced in the database).
 */
export function AccountTypeForm({
  initialAccountType,
}: {
  initialAccountType: "customer" | "vendor" | null;
}) {
  const [state, formAction] = useActionState(
    chooseAccountTypeAction,
    idleState,
  );
  const [selected, setSelected] = React.useState<"customer" | "vendor" | null>(
    initialAccountType,
  );

  const locked = Boolean(initialAccountType);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={locked}>
        <legend className="sr-only">Choose your account type</legend>

        <label
          className={cn(
            "flex cursor-pointer flex-col gap-2 rounded-xl border p-5 transition-colors",
            selected === "customer"
              ? "border-primary ring-2 ring-ring"
              : "border-border hover:bg-accent/50",
            locked && selected !== "customer" && "opacity-50",
          )}
        >
          <input
            type="radio"
            name="accountType"
            value="customer"
            checked={selected === "customer"}
            onChange={() => setSelected("customer")}
            className="sr-only"
            required
          />
          <UtensilsCrossed
            className="size-6 text-brand-fresh"
            aria-hidden="true"
          />
          <span className="font-medium">I&apos;m a customer</span>
          <span className="text-sm text-muted-foreground">
            Discover food carts, trucks, and pop-ups near you.
          </span>
        </label>

        <label
          className={cn(
            "flex cursor-pointer flex-col gap-2 rounded-xl border p-5 transition-colors",
            selected === "vendor"
              ? "border-primary ring-2 ring-ring"
              : "border-border hover:bg-accent/50",
            locked && selected !== "vendor" && "opacity-50",
          )}
        >
          <input
            type="radio"
            name="accountType"
            value="vendor"
            checked={selected === "vendor"}
            onChange={() => setSelected("vendor")}
            className="sr-only"
          />
          <Store className="size-6 text-brand-warm" aria-hidden="true" />
          <span className="font-medium">I&apos;m a vendor</span>
          <span className="text-sm text-muted-foreground">
            List your mobile food business and reach more customers.
          </span>
        </label>
      </fieldset>

      {locked ? (
        <p className="text-sm text-muted-foreground">
          Your account type is already set. Continue below.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          This choice is permanent for this account and can&apos;t be changed
          later.
        </p>
      )}

      <SubmitButton className="w-full sm:w-auto" pendingLabel="Continuing…">
        Continue
      </SubmitButton>
    </form>
  );
}
