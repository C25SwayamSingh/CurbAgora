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
import { VendorProfileForm } from "@/features/authentication/components/vendor-profile-form";

export const metadata: Metadata = { title: "Your profile — StreetEats" };

const VENDOR_ONBOARDING_STEPS = [
  "Account type",
  "Your details",
  "Two-factor setup",
  "Your organization",
];

export default async function VendorProfilePage() {
  const ctx = await requireMfaSatisfied("/onboarding/vendor/profile");

  if (ctx.profile?.account_type !== "vendor") {
    redirect("/onboarding");
  }
  if (ctx.memberships.length > 0) {
    redirect("/vendor");
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <OnboardingSteps steps={VENDOR_ONBOARDING_STEPS} current={1} />
        <Card>
          <CardHeader>
            <CardTitle>Tell us about yourself</CardTitle>
            <CardDescription>
              Just the basics — you can change these anytime in your account
              settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VendorProfileForm
              initialDisplayName={ctx.profile?.display_name ?? ""}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
