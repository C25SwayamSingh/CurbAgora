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
import { MfaEnrollment } from "@/features/authentication/components/mfa-enrollment";

export const metadata: Metadata = {
  title: "Set up two-factor authentication — CurbAgora",
};

/**
 * Mandatory MFA enrollment step. Reached whenever a guard determines the
 * user must enroll a factor before continuing — organization owners/managers
 * performing sensitive actions (`requireVendorSensitiveAction`) or platform
 * admins — see `src/lib/auth/guards.ts`. Org creation and dashboard access
 * no longer require MFA, so those guards never redirect here.
 */
export default async function MfaEnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next, "/onboarding");

  const ctx = await requireAuth("/mfa-enroll");
  if (ctx.aal === "aal2") {
    // Already fully verified — nothing to enroll for this flow.
    redirect(nextPath);
  }
  if (ctx.mfaEnrolled) {
    // A factor already exists; the remaining step is the challenge, not
    // enrollment.
    redirect(`/mfa-challenge?next=${encodeURIComponent(nextPath)}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up two-factor authentication</CardTitle>
        <CardDescription>
          This step is required before you can continue — organization owners
          and managers must protect their account with an authenticator app.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MfaEnrollment nextPath={nextPath} />
      </CardContent>
    </Card>
  );
}
