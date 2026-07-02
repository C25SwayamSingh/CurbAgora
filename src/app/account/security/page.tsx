import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { AppShell } from "@/components/app/app-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireMfaSatisfied } from "@/lib/auth/guards";
import { safeNextPath } from "@/lib/auth/redirect";
import { createServerClient } from "@/lib/supabase/server";
import { SecurityPanel } from "@/features/authentication/components/security-panel";

export const metadata: Metadata = { title: "Security — StreetEats" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; mfa?: string; next?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireMfaSatisfied("/account/security");
  const nextPath = params.next ? safeNextPath(params.next) : undefined;

  const supabase = await createServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verifiedFactors = (factors?.totp ?? [])
    .filter((f) => f.status === "verified")
    .map((f) => ({
      id: f.id,
      friendlyName: f.friendly_name ?? null,
      createdAt: f.created_at,
    }));

  const isVendorLeadership = ctx.memberships.some(
    (m) => m.role === "owner" || m.role === "manager",
  );

  return (
    <AppShell
      nav={[
        {
          href:
            ctx.profile?.account_type === "vendor" ? "/vendor" : "/customer",
          label: "Dashboard",
        },
        { href: "/account", label: "Account" },
      ]}
    >
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
          <p className="text-sm text-muted-foreground">
            Protect your account with a second sign-in step.
          </p>
        </div>

        {params.reason === "admin-mfa-required" ? (
          <Alert variant="destructive">
            <ShieldAlert aria-hidden="true" />
            <AlertDescription>
              Platform administration requires two-factor authentication. Set up
              an authenticator app below, then sign in again.
            </AlertDescription>
          </Alert>
        ) : null}

        {params.reason === "mfa-required" ? (
          <Alert variant="destructive">
            <ShieldAlert aria-hidden="true" />
            <AlertDescription>
              Two-factor authentication is required for organization owners and
              managers before you can continue. Set up an authenticator app
              below.
            </AlertDescription>
          </Alert>
        ) : null}

        {isVendorLeadership && verifiedFactors.length === 0 ? (
          <Alert>
            <ShieldAlert aria-hidden="true" />
            <AlertDescription>
              As an organization {""}
              {ctx.memberships.some((m) => m.role === "owner")
                ? "owner"
                : "manager"}
              , two-factor authentication is required. Sensitive team and
              organization changes require an MFA-verified session.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Sign-in security</CardTitle>
            <CardDescription>
              Two-factor authentication and session control.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SecurityPanel
              verifiedFactors={verifiedFactors}
              aal={ctx.aal}
              nextPath={nextPath}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
