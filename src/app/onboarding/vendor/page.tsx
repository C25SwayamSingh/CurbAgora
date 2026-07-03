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
import { requireVendorForOrgCreation } from "@/lib/auth/guards";
import { CreateOrganizationForm } from "@/features/organizations/components/create-organization-form";

export const metadata: Metadata = {
  title: "Create your organization — CurbAgora",
};

const VENDOR_ONBOARDING_STEPS = [
  "Get started",
  "Your details",
  "Two-factor setup",
  "Your organization",
];

export default async function VendorOnboardingPage() {
  // Mandatory: MFA must be enrolled AND verified (aal2) before an
  // organization can be created — enforced again independently by the
  // create_organization_with_owner() database function.
  const ctx = await requireVendorForOrgCreation("/onboarding/vendor");

  // Already owns/belongs to an org — onboarding is effectively done.
  if (ctx.memberships.length > 0) {
    redirect("/vendor");
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <OnboardingSteps steps={VENDOR_ONBOARDING_STEPS} current={3} />
        <Card>
          <CardHeader>
            <CardTitle>Create your organization</CardTitle>
            <CardDescription>
              Your organization holds your business details and team. You will
              be its owner.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateOrganizationForm />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
