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
import {
  requireMfaSatisfied,
  resolveVendorOnboardingPath,
} from "@/lib/auth/guards";
import { AccountTypeForm } from "@/features/authentication/components/account-type-form";

export const metadata: Metadata = { title: "Get started — StreetEats" };

export default async function OnboardingPage() {
  const ctx = await requireMfaSatisfied("/onboarding");

  if (ctx.profile?.onboarding_status === "complete") {
    redirect(ctx.profile.account_type === "vendor" ? "/vendor" : "/customer");
  }

  // Resume where the user left off. Vendors resume at whichever mandatory
  // step (MFA, then organization creation) is still incomplete.
  if (ctx.profile?.account_type === "vendor") {
    redirect(resolveVendorOnboardingPath(ctx));
  }
  if (ctx.profile?.account_type === "customer") {
    redirect("/onboarding/customer");
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <OnboardingSteps steps={["Account type", "Your details"]} current={0} />
        <Card>
          <CardHeader>
            <CardTitle>How will you use StreetEats?</CardTitle>
            <CardDescription>
              This sets up the right experience for you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccountTypeForm
              initialAccountType={ctx.profile?.account_type ?? null}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
