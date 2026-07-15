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
import { VendorProfileForm } from "@/features/authentication/components/vendor-profile-form";

export const metadata: Metadata = { title: pageTitle("Your profile") };

const VENDOR_ONBOARDING_STEPS = [
  "Get started",
  "Your details",
  "Your organization",
];

export default async function VendorProfilePage() {
  const ctx = await requireMfaSatisfied("/onboarding/vendor/profile");

  if (ctx.memberships.length > 0) {
    redirect("/vendor");
  }

  if (ctx.profile?.display_name?.trim()) {
    redirect("/onboarding/vendor");
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl space-y-4">
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
        <Button asChild variant="ghost" size="sm">
          <Link href="/customer">Back to customer home</Link>
        </Button>
      </div>
    </AppShell>
  );
}
