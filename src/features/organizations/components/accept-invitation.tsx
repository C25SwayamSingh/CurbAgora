"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { idleState } from "@/features/authentication/action-state";
import { SubmitButton } from "@/features/authentication/components/submit-button";
import { acceptInvitationAction } from "@/features/organizations/invitation-actions";

/**
 * The accept step. The server re-checks everything the preview checked —
 * status, expiry, and that the signed-in address matches the invited one —
 * under a row lock, so a stale page or a double tap cannot produce two
 * memberships.
 */
export function AcceptInvitation({
  token,
  organizationName,
}: {
  token: string;
  organizationName: string;
}) {
  const [state, formAction] = useActionState(acceptInvitationAction, idleState);

  if (state.status === "success") {
    return (
      <div className="space-y-3">
        <Alert variant="success">
          <CheckCircle2 aria-hidden="true" />
          <AlertDescription>
            You&apos;re on the team at {organizationName}.
          </AlertDescription>
        </Alert>
        <Button asChild>
          <Link href="/vendor">Go to the dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <SubmitButton pendingLabel="Joining…">
        Join {organizationName}
      </SubmitButton>
    </form>
  );
}
