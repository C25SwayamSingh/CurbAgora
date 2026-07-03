import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";

import { AuthenticatedAppShell } from "@/components/app/authenticated-app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { pageTitle } from "@/lib/app-config";
import { requireCustomer } from "@/lib/auth/guards";

export const metadata: Metadata = { title: pageTitle("Home") };

export default async function CustomerDashboardPage() {
  const ctx = await requireCustomer("/customer");

  return (
    <AuthenticatedAppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome
            {ctx.profile?.display_name ? `, ${ctx.profile.display_name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            Your customer dashboard.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Discover vendors</CardTitle>
              <CardDescription>
                Vendor discovery with live locations is coming in a future
                release. For now you can browse the preview page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/discover">
                  <MapPin aria-hidden="true" />
                  Browse vendors
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Nothing else here yet</CardTitle>
              <CardDescription>
                Favorites, reviews, and loyalty rewards arrive in later phases —
                this dashboard will grow with them.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </AuthenticatedAppShell>
  );
}
