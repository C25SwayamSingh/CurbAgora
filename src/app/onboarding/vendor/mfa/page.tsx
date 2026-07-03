import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/app/app-shell";
import { OnboardingSteps } from "@/components/app/onboarding-steps";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAuth } from "@/lib/auth/guards";
import { MfaChallengeForm } from "@/features/authentication/components/mfa-challenge-form";
import { MfaEnrollment } from "@/features/authentication/components/mfa-enrollment";

export const metadata: Metadata = {
  title: "Two-factor setup — CurbAgora",
};

const VENDOR_ONBOARDING_STEPS = [
  "Get started",
  "Your details",
  "Two-factor setup",
  "Your organization",
];

const NEXT_STEP = "/onboarding/vendor";

/**
 * Mandatory step 3 of vendor onboarding: organization owners must enroll
 * AND verify a TOTP factor before they can create their organization (step
 * 4). This is enforced again independently by `requireVendorForOrgCreation`
 * on the organization-creation page/action and by the database (an aal2 JWT
 * is required by `create_organization_with_owner`) — this page is only the
 * guided UX for the mandatory step, never the sole enforcement point.
 */
export default async function VendorMfaOnboardingPage() {
  const ctx = await requireAuth("/onboarding/vendor/mfa");

  if (ctx.memberships.length > 0) {
    redirect("/vendor");
  }
  if (ctx.aal === "aal2") {
    redirect(NEXT_STEP);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <OnboardingSteps steps={VENDOR_ONBOARDING_STEPS} current={2} />
        <Card>
          <CardHeader>
            <CardTitle>Protect your business account</CardTitle>
            <CardDescription>
              Organization owners must set up two-factor authentication before
              creating an organization. This keeps your team and business data
              safe even if your password is ever compromised.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!ctx.mfaEnrolled ? (
              <MfaEnrollment nextPath={NEXT_STEP} />
            ) : (
              <div className="space-y-4">
                <Alert>
                  <ShieldCheck aria-hidden="true" />
                  <AlertDescription>
                    Enter the 6-digit code from your authenticator app to verify
                    this session and continue.
                  </AlertDescription>
                </Alert>
                <MfaChallengeForm nextPath={NEXT_STEP} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
