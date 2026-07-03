import type { Metadata } from "next";

import { AppShell } from "@/components/app/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin — CurbAgora" };

/**
 * Platform administration placeholder. Access requires a row in
 * platform_admins (service-role/migration managed) AND an aal2 session —
 * enforced by requirePlatformAdmin and mirrored by RLS at the database.
 */
export default async function AdminPage() {
  await requirePlatformAdmin("/admin");

  const supabase = await createServerClient();
  const [{ count: orgCount }, { count: profileCount }] = await Promise.all([
    supabase.from("organizations").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
  ]);

  return (
    <AppShell nav={[{ href: "/account/security", label: "Security" }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Platform administration
          </h1>
          <p className="text-sm text-muted-foreground">
            Restricted area. Your session is MFA-verified.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{orgCount ?? 0}</CardTitle>
              <CardDescription>Organizations</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{profileCount ?? 0}</CardTitle>
              <CardDescription>User profiles</CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Moderation tools</CardTitle>
            <CardDescription>
              Vendor moderation, user management, and platform configuration are
              planned for a later phase.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Admin roles are granted only via database migration or the service
              role — there is intentionally no in-app path to grant them.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
