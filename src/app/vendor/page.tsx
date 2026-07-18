import type { Metadata } from "next";
import Link from "next/link";
import { Shield, ShieldCheck, Users } from "lucide-react";

import { AuthenticatedAppShell } from "@/components/app/authenticated-app-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { pageTitle } from "@/lib/app-config";
import { isMfaMandatoryRole, requireVendorDashboard } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";
import { VendorUnitsSection } from "@/features/vendors/components/vendor-units-section";

export const metadata: Metadata = { title: pageTitle("Vendor dashboard") };

export default async function VendorDashboardPage() {
  const ctx = await requireVendorDashboard("/vendor");

  const supabase = await createServerClient();

  const [
    { data: organization },
    { data: members },
    { data: vendorUnits },
    { data: openLocationSessions },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("*")
      .eq("id", ctx.membership.organization_id)
      .maybeSingle(),
    supabase
      .from("organization_members")
      .select("*")
      .eq("organization_id", ctx.membership.organization_id)
      .order("created_at"),
    supabase
      .from("vendor_units")
      .select("*")
      .eq("organization_id", ctx.membership.organization_id)
      .order("created_at"),
    supabase
      .from("vendor_location_sessions")
      .select("*")
      .eq("organization_id", ctx.membership.organization_id)
      .is("ended_at", null),
  ]);

  const isLeadership = isMfaMandatoryRole(ctx.membership.role);
  const canManageUnit =
    ctx.membership.role === "owner" || ctx.membership.role === "manager";
  const openLocationSessionsByUnitId = Object.fromEntries(
    (openLocationSessions ?? []).map((session) => [
      session.vendor_unit_id,
      session,
    ]),
  );

  return (
    <AuthenticatedAppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {organization?.display_name ?? "Your organization"}
          </h1>
          <p className="text-sm text-muted-foreground">
            You are {ctx.membership.role === "owner" ? "an" : "a"}{" "}
            <strong>{ctx.membership.role}</strong> of this organization.
          </p>
        </div>

        {isLeadership && ctx.aal !== "aal2" ? (
          <Alert variant="default">
            <Shield aria-hidden="true" />
            <AlertDescription>
              Add two-factor authentication to better protect your business
              account.{" "}
              <Link
                href="/account/security"
                className="font-medium underline underline-offset-2"
              >
                Set it up
              </Link>
            </AlertDescription>
          </Alert>
        ) : isLeadership && ctx.aal === "aal2" ? (
          <Alert variant="success">
            <ShieldCheck aria-hidden="true" />
            <AlertDescription>
              Two-factor authentication is verified for this session — helps
              protect {ctx.membership.role === "owner" ? "owners" : "managers"}{" "}
              managing this organization.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Organization</CardTitle>
              <CardDescription>Your business details.</CardDescription>
            </CardHeader>
            <CardContent>
              {organization ? (
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Display name</dt>
                    <dd className="font-medium">{organization.display_name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Legal name</dt>
                    <dd className="font-medium">{organization.legal_name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">URL name</dt>
                    <dd className="font-medium">{organization.slug}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="font-medium capitalize">
                      {organization.status}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Organization details are unavailable right now.
                </p>
              )}
              {organization && ctx.membership.role === "owner" ? (
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <Link href="/vendor/organization/edit">Edit</Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <span className="flex items-center gap-2">
                  <Users className="size-5" aria-hidden="true" />
                  Team
                </span>
              </CardTitle>
              <CardDescription>
                {isLeadership
                  ? "Everyone with access to this organization."
                  : "Your membership. Owners and managers can see the full team."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {members && members.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {members.map((member) => (
                    <li
                      key={member.id}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                    >
                      <span className="font-medium">
                        {member.user_id === ctx.user.id ? "You" : "Team member"}
                      </span>
                      <span className="capitalize text-muted-foreground">
                        {member.role}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No team members to show.
                </p>
              )}
              {isLeadership ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Team invitations are coming in a later release.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {organization ? (
          <VendorUnitsSection
            units={vendorUnits ?? []}
            organizationSlug={organization.slug}
            canManage={canManageUnit}
            canManageLocation
            openLocationSessionsByUnitId={openLocationSessionsByUnitId}
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Next up for your business</CardTitle>
            <CardDescription>
              Menus and customer reviews are planned for upcoming phases — they
              are not available yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/account">Manage your account</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AuthenticatedAppShell>
  );
}
