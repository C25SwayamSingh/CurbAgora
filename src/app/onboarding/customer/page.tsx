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
import { requireMfaSatisfied } from "@/lib/auth/guards";
import { CustomerOnboardingForm } from "@/features/authentication/components/customer-onboarding-form";

export const metadata: Metadata = { title: "Your profile — StreetEats" };

export default async function CustomerOnboardingPage() {
  const ctx = await requireMfaSatisfied("/onboarding/customer");

  if (ctx.profile?.onboarding_status === "complete") {
    redirect(ctx.profile.account_type === "vendor" ? "/vendor" : "/customer");
  }
  if (ctx.profile?.account_type !== "customer") {
    redirect("/onboarding");
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <OnboardingSteps steps={["Account type", "Your details"]} current={1} />
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
      </div>
    </AppShell>
  );
}
