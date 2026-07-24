import type { Metadata } from "next";
import Link from "next/link";
import { Gift, QrCode, Shield, ShieldCheck, Users } from "lucide-react";

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
import { TeamInvitePanel } from "@/features/organizations/components/team-invite-panel";

export const metadata: Metadata = { title: pageTitle("Vendor dashboard") };

export default async function VendorDashboardPage() {
  const ctx = await requireVendorDashboard("/vendor");

  const supabase = await createServerClient();

  const [
    { data: organization },
    { data: members },
    { data: vendorUnits },
    { data: openLocationSessions },
    { data: loyaltyPreview },
    { data: profiles },
    { data: invitations },
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
    // The view already excludes programs that cannot award, so a row here
    // means rewards are genuinely live.
    supabase
      .from("loyalty_program_previews")
      .select("points_per_dollar, catalog")
      .eq("organization_id", ctx.membership.organization_id)
      .maybeSingle(),
    // Co-members may read each other's display names (profiles_select_shared_org).
    // Without them the roster reads "Team member / staff" for everyone, which
    // cannot answer the only question it exists to answer: who is this?
    supabase.from("profiles").select("id, display_name"),
    // RLS restricts this to owners/managers; staff get an empty list.
    supabase
      .from("organization_invitations")
      .select("id, email, first_name, role, expires_at")
      .eq("organization_id", ctx.membership.organization_id)
      .eq("status", "pending")
      .order("created_at"),
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
  const loyalty = loyaltyPreview
    ? {
        pointsPerDollar: loyaltyPreview.points_per_dollar,
        rewardCount: (loyaltyPreview.catalog ?? []).length,
      }
    : null;

  const namesByUserId = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name.trim()]),
  );
  /** A name someone set, or an honest placeholder — never a fake one. */
  function nameFor(userId: string): string {
    return namesByUserId.get(userId) || "Unnamed member";
  }

  const pendingInvites = (invitations ?? []).map((invite) => ({
    id: invite.id,
    email: invite.email,
    firstName: invite.first_name,
    role: invite.role,
    expiresAt: invite.expires_at,
  }));

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
                        {nameFor(member.user_id)}
                        {member.user_id === ctx.user.id ? (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (you)
                          </span>
                        ) : null}
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
              {canManageUnit ? (
                <div className="mt-4 border-t border-border pt-4">
                  <TeamInvitePanel
                    canInviteOwner={ctx.membership.role === "owner"}
                    pending={pendingInvites}
                  />
                </div>
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
            loyalty={loyalty}
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="size-5 text-brand" aria-hidden="true" />
              Loyalty &amp; rewards
            </CardTitle>
            <CardDescription>
              Customers earn points on what they spend and trade them for
              rewards you choose. CurbAgora prices each reward and shows what it
              costs you before anything goes live.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/vendor/checkout">
                <QrCode aria-hidden="true" />
                Open checkout
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/vendor/loyalty">
                <Gift aria-hidden="true" />
                Rewards &amp; program
              </Link>
            </Button>
          </CardContent>
        </Card>

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
