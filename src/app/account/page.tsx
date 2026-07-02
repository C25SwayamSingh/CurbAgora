import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireMfaSatisfied } from "@/lib/auth/guards";
import { ProfileForm } from "@/features/authentication/components/profile-form";

export const metadata: Metadata = { title: "Account — StreetEats" };

export default async function AccountPage() {
  const ctx = await requireMfaSatisfied("/account");

  return (
    <AppShell
      nav={[
        {
          href:
            ctx.profile?.account_type === "vendor" ? "/vendor" : "/customer",
          label: "Dashboard",
        },
        { href: "/account/security", label: "Security" },
      ]}
    >
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {ctx.user.email}
            {ctx.profile?.account_type
              ? ` · ${ctx.profile.account_type} account`
              : null}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              How your name appears across StreetEats.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              initialDisplayName={ctx.profile?.display_name ?? ""}
              initialAvatarUrl={ctx.profile?.avatar_url ?? null}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>
              Two-factor authentication and active sessions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/account/security">
                <ShieldCheck aria-hidden="true" />
                Manage security settings
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
