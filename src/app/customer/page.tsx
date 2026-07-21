import type { Metadata } from "next";
import Link from "next/link";
import { Gift, MapPin } from "lucide-react";

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
                See carts, trucks, and stands that are live near you right now —
                as a list or on a map.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/discover">
                  <MapPin aria-hidden="true" />
                  Find vendors near me
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My rewards</CardTitle>
              <CardDescription>
                Track your stamp cards from neighborhood vendors and show your
                code at the counter to earn or redeem.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/rewards">
                  <Gift aria-hidden="true" />
                  View my rewards
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AuthenticatedAppShell>
  );
}
