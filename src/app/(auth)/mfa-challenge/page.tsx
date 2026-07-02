import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAuth } from "@/lib/auth/guards";
import { safeNextPath } from "@/lib/auth/redirect";
import { MfaChallengeForm } from "@/features/authentication/components/mfa-challenge-form";

export const metadata: Metadata = { title: "Two-factor check — StreetEats" };

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next, "/onboarding");

  const ctx = await requireAuth("/mfa-challenge");
  if (!ctx.mfaUpgradeRequired) {
    // Session is already fully verified (or no factor is enrolled).
    redirect(nextPath);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor verification</CardTitle>
        <CardDescription>
          Enter the 6-digit code from your authenticator app to finish signing
          in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MfaChallengeForm nextPath={nextPath} />
      </CardContent>
    </Card>
  );
}
