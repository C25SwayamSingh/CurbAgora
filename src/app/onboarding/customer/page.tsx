import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { AppShell } from "@/components/app/app-shell";
import { OnboardingSteps } from "@/components/app/onboarding-steps";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { pageTitle } from "@/lib/app-config";
import { requireMfaSatisfied } from "@/lib/auth/guards";
import { CustomerOnboardingForm } from "@/features/authentication/components/customer-onboarding-form";

export const metadata: Metadata = { title: pageTitle("Your profile") };

export default async function CustomerOnboardingPage() {
  const ctx = await requireMfaSatisfied("/onboarding/customer");

  if (ctx.profile?.onboarding_status === "complete") {
    redirect("/customer");
  }
  if (
    ctx.profile?.preferred_mode !== "customer" &&
    ctx.profile?.onboarding_status !== "in_progress"
  ) {
    redirect("/onboarding");
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <OnboardingSteps steps={["Get started", "Your details"]} current={1} />
        <Card>
          <CardHeader>
            <CardTitle>Tell us about yourself</CardTitle>
            <CardDescription>
              Just the basics — you can change these anytime in your account
              settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CustomerOnboardingForm
              initialDisplayName={ctx.profile?.display_name ?? ""}
            />
          </CardContent>
        </Card>
        <Button asChild variant="ghost" size="sm" className="mt-4">
          <Link href="/onboarding?choose=1">Back</Link>
        </Button>
      </div>
    </AppShell>
  );
}
