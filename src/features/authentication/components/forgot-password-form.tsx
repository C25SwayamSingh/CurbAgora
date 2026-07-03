"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, MailCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  errorState,
  idleState,
  successState,
  type ActionState,
} from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { forgotPasswordSchema } from "@/features/authentication/schemas";
import { sameOriginRecoveryPath } from "@/lib/auth/recovery-path";
import { createBrowserClient } from "@/lib/supabase/client";

const SUCCESS_MESSAGE =
  "If an account exists for that email, a reset link is on its way.";

const LOCAL_MAILPIT_URL = "http://localhost:54324";
const DEV_RECOVERY_POLL_MS = 500;
const DEV_RECOVERY_POLL_ATTEMPTS = 30;

type DevRecoveryStatus =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "found"; resetUrl: string | null }
  | { kind: "timeout"; registered: boolean | null }
  | { kind: "unavailable" };

async function checkLocalRegistration(email: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `/api/dev/auth/email-registered?email=${encodeURIComponent(email)}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as {
      checked?: boolean;
      registered?: boolean;
    };
    return data.checked ? Boolean(data.registered) : null;
  } catch {
    return null;
  }
}

function DevRecoveryWatcher({
  email,
  requestedAt,
}: {
  email: string;
  requestedAt: string;
}) {
  const [status, setStatus] = React.useState<DevRecoveryStatus>({
    kind: "waiting",
  });

  React.useEffect(() => {
    if (process.env.NEXT_PUBLIC_APP_ENV !== "development") {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    async function poll() {
      while (!cancelled && attempts < DEV_RECOVERY_POLL_ATTEMPTS) {
        attempts += 1;
        try {
          const params = new URLSearchParams({
            email,
            since: requestedAt,
          });
          const res = await fetch(
            `/api/dev/mailpit/recovery?${params.toString()}`,
            { cache: "no-store" },
          );
          if (res.ok) {
            const data = (await res.json()) as {
              found?: boolean;
              resetUrl?: string | null;
              reason?: string;
            };
            if (data.reason === "mailpit_unavailable") {
              setStatus({ kind: "unavailable" });
              return;
            }
            if (data.found) {
              setStatus({ kind: "found", resetUrl: data.resetUrl ?? null });
              return;
            }
          }
        } catch {
          setStatus({ kind: "unavailable" });
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, DEV_RECOVERY_POLL_MS),
        );
      }
      if (!cancelled) {
        const registered = await checkLocalRegistration(email);
        setStatus({ kind: "timeout", registered });
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [email, requestedAt]);

  if (status.kind === "waiting") {
    return (
      <p className="text-sm text-muted-foreground">
        Waiting for the reset email in local Mailpit…
      </p>
    );
  }

  if (status.kind === "found") {
    const recoveryPath = status.resetUrl
      ? sameOriginRecoveryPath(status.resetUrl)
      : null;

    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>Reset email received in Mailpit.</p>
        {recoveryPath ? (
          <Button asChild type="button" className="w-full">
            <Link href={recoveryPath}>Continue password reset in this tab</Link>
          </Button>
        ) : null}
        <p>
          Use the button above instead of clicking the link inside Mailpit.
          Mailpit opens external email links in new tabs (
          <code className="rounded bg-muted px-1 py-0.5">
            target=&quot;_blank&quot;
          </code>
          ) and may open more than one from a single click.
        </p>
        <p>
          Or open{" "}
          <a
            href={LOCAL_MAILPIT_URL}
            className="text-primary underline-offset-4 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Mailpit
          </a>{" "}
          to read the email, then return here and use the button.
        </p>
      </div>
    );
  }

  if (status.kind === "timeout") {
    if (status.registered === false) {
      return (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>
            No local account exists for <strong>{email}</strong>. Password reset
            emails are never sent for unknown addresses (even though the form
            says success).{" "}
            <Link href="/sign-up" className="underline underline-offset-4">
              Sign up
            </Link>{" "}
            first, or re-create your user after{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              npm run db:reset
            </code>
            .
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <p className="text-sm text-muted-foreground">
        No new reset email yet. Wait about a minute between tries, then check{" "}
        <a
          href={LOCAL_MAILPIT_URL}
          className="text-primary underline-offset-4 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Mailpit
        </a>
        .
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      Local Mailpit is not reachable. Run{" "}
      <code className="rounded bg-muted px-1 py-0.5">npm run db:start</code> and
      open{" "}
      <a
        href={LOCAL_MAILPIT_URL}
        className="text-primary underline-offset-4 hover:underline"
        target="_blank"
        rel="noreferrer"
      >
        Mailpit
      </a>
      .
    </p>
  );
}

/**
 * Request a password reset directly from the browser so we skip the server
 * action round trip. Supabase still sends the email; we always show success to
 * avoid email enumeration unless Supabase returns an explicit rate-limit error.
 */
export function ForgotPasswordForm() {
  const [state, setState] = React.useState<ActionState>(idleState);
  const [pending, setPending] = React.useState(false);
  const [submittedEmail, setSubmittedEmail] = React.useState<string | null>(
    null,
  );
  const [requestedAt, setRequestedAt] = React.useState<string | null>(null);
  const submitLockRef = React.useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const parsed = forgotPasswordSchema.safeParse({
      email: formData.get("email"),
    });

    if (!parsed.success) {
      setState(
        errorState(
          "Please fix the highlighted fields.",
          parsed.error.flatten().fieldErrors,
        ),
      );
      return;
    }

    submitLockRef.current = true;
    setPending(true);
    try {
      if (process.env.NEXT_PUBLIC_APP_ENV === "development") {
        const registered = await checkLocalRegistration(parsed.data.email);
        if (registered === false) {
          setState(
            errorState(
              "No local account exists for this email. Sign up first — local users are wiped when you run db:reset or db:stop.",
            ),
          );
          return;
        }
      }

      const supabase = createBrowserClient();
      // Token-hash recovery uses /auth/recovery → /auth/confirm (see recovery email template).
      const redirectTo = `${window.location.origin}/auth/confirm`;
      const { error } = await supabase.auth.resetPasswordForEmail(
        parsed.data.email,
        { redirectTo },
      );

      if (error?.code === "over_email_send_rate_limit") {
        setState(
          errorState(
            "Too many reset emails requested. Wait about a minute, then try again.",
          ),
        );
        return;
      }

      if (error) {
        console.error("password-reset request failed", { code: error.code });
      }

      setSubmittedEmail(parsed.data.email);
      setRequestedAt(new Date().toISOString());
      setState(successState(SUCCESS_MESSAGE));
    } finally {
      setPending(false);
      submitLockRef.current = false;
    }
  }

  if (state.status === "success" && submittedEmail && requestedAt) {
    return (
      <div className="space-y-3">
        <Alert variant="success">
          <MailCheck aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        {process.env.NEXT_PUBLIC_APP_ENV === "development" ? (
          <DevRecoveryWatcher
            email={submittedEmail}
            requestedAt={requestedAt}
          />
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-describedby="email-error"
          aria-invalid={Boolean(state.fieldErrors?.email)}
        />
        <FieldError id="email-error" errors={state.fieldErrors?.email} />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending link…" : "Send reset link"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link
          href="/sign-in"
          className="text-primary underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
