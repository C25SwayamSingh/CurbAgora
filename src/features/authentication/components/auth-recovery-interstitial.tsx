"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRecoveryTabLeader } from "@/features/authentication/hooks/use-recovery-tab-leader";

/**
 * Interstitial step for password-reset emails. Email clients and Mailpit may
 * prefetch direct verify links; this page only verifies after an explicit POST.
 */
export function AuthRecoveryInterstitial() {
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const tabLeader = useRecoveryTabLeader(tokenHash);
  const [submitting, setSubmitting] = React.useState(false);

  const isValidRecovery = Boolean(tokenHash && type === "recovery");

  function handleSubmit() {
    if (submitting) {
      return;
    }
    setSubmitting(true);
  }

  if (!isValidRecovery) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>This reset link isn&apos;t valid</CardTitle>
            <CardDescription>
              The link is missing required details. Request a new reset email
              and open it once.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild>
              <Link href="/forgot-password">Request a new reset link</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/sign-in">Go to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (tabLeader === "pending") {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-12">
        <p className="text-center text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (tabLeader === "duplicate") {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Reset already open in another tab</CardTitle>
            <CardDescription>
              Mailpit may have opened several tabs from one email click. Close
              this tab and continue in the other reset tab.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Continue password reset</CardTitle>
          <CardDescription>
            Click once below to open the password form. Reset links are
            single-use — don&apos;t refresh this page after continuing.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form action="/auth/confirm" method="POST" onSubmit={handleSubmit}>
            <input type="hidden" name="token_hash" value={tokenHash ?? ""} />
            <input type="hidden" name="type" value="recovery" />
            <Button
              type="submit"
              className="w-full"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? "Continuing…" : "Continue to reset password"}
            </Button>
          </form>
          <Button asChild variant="outline">
            <Link href="/sign-in">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
