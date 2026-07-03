import type { Metadata } from "next";
import Link from "next/link";

import { AuthenticatedAppShell } from "@/components/app/authenticated-app-shell";
import { InitialsAvatar } from "@/components/app/initials-avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { APP_CONFIG, pageTitle } from "@/lib/app-config";
import { effectivePreferredMode, hasVendorMembership } from "@/lib/auth/mode";
import { requireMfaSatisfied } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/features/authentication/components/profile-form";

export const metadata: Metadata = { title: pageTitle("Account") };

export default async function AccountPage() {
  const ctx = await requireMfaSatisfied("/account");
  const mode = effectivePreferredMode(ctx);
  const isVendorMember = hasVendorMembership(ctx);

  let orgSummary: { displayName: string; role: string } | null = null;
  if (isVendorMember && ctx.memberships[0]) {
    const supabase = await createServerClient();
    const { data: org } = await supabase
      .from("organizations")
      .select("display_name")
      .eq("id", ctx.memberships[0].organization_id)
      .maybeSingle();
    orgSummary = {
      displayName: org?.display_name ?? "Your organization",
      role: ctx.memberships[0].role,
    };
  }

  const displayName = ctx.profile?.display_name?.trim() || "Your account";

  return (
    <AuthenticatedAppShell
      extraNav={[{ href: "/account/security", label: "Security" }]}
    >
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-start gap-4">
          <InitialsAvatar displayName={displayName} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
            <p className="text-sm text-muted-foreground">
              Manage how you appear on {APP_CONFIG.name}.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Display name and email. Avatar images will use Supabase Storage in
              a future release — for now we show initials from your name.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Email</p>
              <p className="text-sm text-muted-foreground">{ctx.user.email}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Preferred interface</p>
              <p className="text-sm capitalize text-muted-foreground">
                {mode}
                {!isVendorMember && ctx.profile?.preferred_mode === "vendor"
                  ? " (complete vendor setup to access vendor tools)"
                  : null}
              </p>
            </div>
            <ProfileForm initialDisplayName={ctx.profile?.display_name ?? ""} />
          </CardContent>
        </Card>

        {orgSummary ? (
          <Card>
            <CardHeader>
              <CardTitle>Organization</CardTitle>
              <CardDescription>
                Vendor access comes from active membership — not interface mode
                alone.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                <span className="font-medium">{orgSummary.displayName}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {orgSummary.role}
                </span>
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Vendor setup</CardTitle>
              <CardDescription>
                Create or join an organization to manage a mobile food business
                on {APP_CONFIG.name}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/onboarding/vendor/profile">Become a vendor</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>
              Password, two-factor authentication, and session control.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/account/security">Manage security settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AuthenticatedAppShell>
  );
}
