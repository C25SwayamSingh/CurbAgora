import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { OnboardingSteps } from "@/components/app/onboarding-steps";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { pageTitle } from "@/lib/app-config";
import { hasVendorMembership, resolveDashboardPath } from "@/lib/auth/mode";
import {
  requireMfaSatisfied,
  resolveVendorOnboardingPath,
} from "@/lib/auth/guards";
import { OnboardingPathForm } from "@/features/authentication/components/onboarding-path-form";

export const metadata: Metadata = { title: pageTitle("Get started") };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ choose?: string }>;
}) {
  const ctx = await requireMfaSatisfied("/onboarding");
  const { choose } = await searchParams;

  if (
    ctx.profile?.onboarding_status === "complete" &&
    hasVendorMembership(ctx)
  ) {
    redirect(resolveDashboardPath(ctx));
  }

  if (
    ctx.profile?.onboarding_status === "complete" &&
    !hasVendorMembership(ctx)
  ) {
    redirect("/customer");
  }

  // A deliberate "Back" from step 2 (?choose=1) re-shows the path choice
  // instead of auto-resuming step 2 — the resume shortcut below only
  // applies to a plain, unprompted visit to this page.
  if (ctx.profile?.onboarding_status === "in_progress" && !choose) {
    if (ctx.profile.preferred_mode === "vendor") {
      redirect(resolveVendorOnboardingPath(ctx));
    }
    redirect("/onboarding/customer");
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <OnboardingSteps steps={["Get started", "Your details"]} current={0} />
        <Card>
          <CardHeader>
            <CardTitle>What would you like to do first?</CardTitle>
            <CardDescription>
              Pick a starting path — you can switch interfaces anytime after
              setup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingPathForm
              initialPreferredMode={ctx.profile?.preferred_mode ?? null}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
