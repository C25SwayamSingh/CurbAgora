"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  signOutAction,
  signOutOtherSessionsAction,
  unenrollMfaAction,
} from "@/features/authentication/actions";
import {
  idleState,
  type ActionState,
} from "@/features/authentication/action-state";
import { ChangePasswordForm } from "@/features/authentication/components/change-password-form";
import { MfaEnrollment } from "@/features/authentication/components/mfa-enrollment";
import { SubmitButton } from "@/features/authentication/components/submit-button";

type VerifiedFactor = {
  id: string;
  friendlyName: string | null;
  createdAt: string;
};

export function SecurityPanel({
  verifiedFactors,
  aal,
  nextPath,
}: {
  verifiedFactors: VerifiedFactor[];
  aal: "aal1" | "aal2";
  nextPath?: string;
}) {
  const [unenrollState, unenrollAction] = useActionState(
    unenrollMfaAction,
    idleState,
  );
  const [sessionsState, setSessionsState] =
    React.useState<ActionState>(idleState);
  const [revoking, setRevoking] = React.useState(false);

  async function revokeOtherSessions() {
    setRevoking(true);
    try {
      setSessionsState(await signOutOtherSessionsAction());
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="font-medium">Password</h3>
        <p className="text-sm text-muted-foreground">
          Update your password while signed in, or use{" "}
          <Link
            href="/forgot-password"
            className="text-primary underline-offset-4 hover:underline"
          >
            password reset
          </Link>{" "}
          if you cannot sign in.
        </p>
        <ChangePasswordForm />
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Two-factor authentication (TOTP)</h3>

        {unenrollState.status === "error" && unenrollState.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{unenrollState.message}</AlertDescription>
          </Alert>
        ) : null}
        {unenrollState.status === "success" && unenrollState.message ? (
          <Alert variant="success">
            <CheckCircle2 aria-hidden="true" />
            <AlertDescription>{unenrollState.message}</AlertDescription>
          </Alert>
        ) : null}

        {verifiedFactors.length === 0 ? (
          <MfaEnrollment nextPath={nextPath} />
        ) : (
          <div className="space-y-3">
            <Alert variant="success">
              <ShieldCheck aria-hidden="true" />
              <AlertDescription>
                Two-factor authentication is on. Signing in requires a code from
                your authenticator app.
              </AlertDescription>
            </Alert>

            <ul className="space-y-2">
              {verifiedFactors.map((factor) => (
                <li
                  key={factor.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {factor.friendlyName || "Authenticator app"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(factor.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <form action={unenrollAction}>
                    <input type="hidden" name="factorId" value={factor.id} />
                    <SubmitButton
                      variant="outline"
                      size="sm"
                      pendingLabel="Removing…"
                    >
                      Remove
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>

            {aal !== "aal2" ? (
              <p className="text-sm text-muted-foreground">
                To remove your authenticator app, first verify this session with
                a code (sign out and back in if needed).
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Sessions</h3>
        <p className="text-sm text-muted-foreground">
          Other sessions are browsers or devices where this account is still
          signed in. Sign them out if you do not recognize a device.
        </p>

        {sessionsState.status === "success" && sessionsState.message ? (
          <Alert variant="success">
            <CheckCircle2 aria-hidden="true" />
            <AlertDescription>{sessionsState.message}</AlertDescription>
          </Alert>
        ) : null}
        {sessionsState.status === "error" && sessionsState.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{sessionsState.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={revokeOtherSessions}
            disabled={revoking}
          >
            {revoking
              ? "Signing out other sessions…"
              : "Sign out other sessions"}
          </Button>
          <form action={signOutAction}>
            <SubmitButton variant="outline" pendingLabel="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </div>
      </section>
    </div>
  );
}
