import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info, TriangleAlert } from "lucide-react";

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
import { requireVendorMember } from "@/lib/auth/guards";
import { publicOrigin } from "@/lib/public-url";
import { createServerClient } from "@/lib/supabase/server";
import { VendorQrPoster } from "@/features/loyalty/components/vendor-qr-poster";

export const metadata: Metadata = { title: pageTitle("Rewards QR code") };

export default async function VendorUnitQrPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireVendorMember(["owner", "manager"], "/vendor");
  const supabase = await createServerClient();

  // Scoped by the caller's own organization, so an id from another org's URL
  // resolves to nothing rather than exposing their unit.
  const [{ data: unit }, { data: organization }] = await Promise.all([
    supabase
      .from("vendor_units")
      .select("id, name, slug")
      .eq("id", id)
      .eq("organization_id", ctx.membership.organization_id)
      .maybeSingle(),
    supabase
      .from("organizations")
      .select("slug")
      .eq("id", ctx.membership.organization_id)
      .maybeSingle(),
  ]);

  if (!unit || !organization) notFound();

  const { origin, localOnly, lanOrigin } = await publicOrigin();
  const path = `/vendors/${organization.slug}/${unit.slug}/rewards`;
  const url = `${origin}${path}`;
  const phoneUrl = lanOrigin ? `${lanOrigin}${path}` : null;

  // On a local origin the QR would encode `localhost`, which resolves to the
  // scanning phone itself and simply fails. Encoding the machine's LAN address
  // instead makes the code work the moment it is pointed at during
  // development; the banner below is explicit that this build is not printable.
  const qrUrl = phoneUrl ?? url;

  return (
    <AuthenticatedAppShell>
      <div className="mx-auto max-w-lg space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Rewards QR code
          </h1>
          <p className="text-sm text-muted-foreground">
            For {unit.name}. Print it once and leave it up.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Print this on your cart</CardTitle>
            <CardDescription>
              Put it on the counter, the menu, a sign, or your packaging.
              Customers scan it to join your rewards and to pull up their
              checkout code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VendorQrPoster url={qrUrl} unitName={unit.name} />
          </CardContent>
        </Card>

        {localOnly ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>
              <strong>Testing code — don&apos;t print this one.</strong>
              <span>
                {" "}
                {phoneUrl ? (
                  <>
                    This site is only running on your computer, so the code
                    above points at{" "}
                    <code className="font-mono break-all">{lanOrigin}</code> —
                    scan it from a phone on the same Wi-Fi and it will work.
                  </>
                ) : (
                  <>
                    This site is only running on your computer at{" "}
                    <code className="font-mono">{origin}</code>, so a phone
                    cannot open the code above.
                  </>
                )}{" "}
                Once CurbAgora is deployed, this page will show the real
                printable code.
              </span>
            </AlertDescription>
          </Alert>
        ) : null}

        <Alert>
          <Info aria-hidden="true" />
          <AlertDescription>
            This code never awards points by itself. Scanning it only opens your
            rewards page — points are added when you enter the eligible subtotal
            at checkout.
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/vendor">
              <ArrowLeft aria-hidden="true" />
              Back to dashboard
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/vendor/checkout">Open checkout</Link>
          </Button>
        </div>
      </div>
    </AuthenticatedAppShell>
  );
}
