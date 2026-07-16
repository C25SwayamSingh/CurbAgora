import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MapPin, Phone, Store } from "lucide-react";

import { InitialsAvatar } from "@/components/app/initials-avatar";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/app-config";
import { createServerClient } from "@/lib/supabase/server";
import {
  CUISINE_CATEGORIES,
  OPERATING_STATUSES,
  PAYMENT_METHODS,
  VENDOR_UNIT_TYPES,
  labelFor,
} from "@/features/vendors/schemas";

async function loadUnit(orgSlug: string, unitSlug: string) {
  const supabase = await createServerClient();
  const { data: unit } = await supabase
    .from("vendor_unit_previews")
    .select("*")
    .eq("organization_slug", orgSlug)
    .eq("slug", unitSlug)
    .maybeSingle();
  return unit;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; unitSlug: string }>;
}): Promise<Metadata> {
  const { orgSlug, unitSlug } = await params;
  const unit = await loadUnit(orgSlug, unitSlug);
  return { title: pageTitle(unit?.name ?? "Vendor not found") };
}

export default async function VendorPublicPreviewPage({
  params,
}: {
  params: Promise<{ orgSlug: string; unitSlug: string }>;
}) {
  const { orgSlug, unitSlug } = await params;
  const unit = await loadUnit(orgSlug, unitSlug);

  if (!unit) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Vendor not found
        </h1>
        <p className="mt-2 text-muted-foreground">
          This vendor page doesn&apos;t exist or isn&apos;t published yet.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Back to home</Link>
        </Button>
      </main>
    );
  }

  const operatingStatusLabel = labelFor(
    OPERATING_STATUSES,
    unit.operating_status,
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← CurbAgora
      </Link>

      <div className="mt-6 flex items-start gap-4">
        <InitialsAvatar displayName={unit.name} className="size-16 text-lg" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{unit.name}</h1>
          <p className="text-muted-foreground">
            <Store
              className="inline size-4 align-text-bottom"
              aria-hidden="true"
            />{" "}
            {labelFor(VENDOR_UNIT_TYPES, unit.unit_type)}
            {" · "}
            <MapPin
              className="inline size-4 align-text-bottom"
              aria-hidden="true"
            />{" "}
            {unit.city}
            {unit.state ? `, ${unit.state}` : ""}
            {unit.neighborhood ? ` · ${unit.neighborhood}` : ""}
          </p>
          <span
            className={
              unit.operating_status === "open"
                ? "mt-2 inline-block rounded-full bg-brand-fresh/15 px-3 py-1 text-xs font-medium text-brand-fresh"
                : "mt-2 inline-block rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
            }
          >
            {operatingStatusLabel}
          </span>
        </div>
      </div>

      {unit.description ? (
        <p className="mt-6 text-sm leading-relaxed">{unit.description}</p>
      ) : null}

      {unit.cuisine_categories.length > 0 ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {unit.cuisine_categories.map((category) => (
            <span
              key={category}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
            >
              {labelFor(CUISINE_CATEGORIES, category)}
            </span>
          ))}
        </div>
      ) : null}

      {unit.contact_phone || unit.contact_email ? (
        <div className="mt-6 space-y-1 text-sm">
          {unit.contact_phone ? (
            <p className="flex items-center gap-2">
              <Phone className="size-4" aria-hidden="true" />
              {unit.contact_phone}
            </p>
          ) : null}
          {unit.contact_email ? (
            <p className="flex items-center gap-2">
              <Mail className="size-4" aria-hidden="true" />
              {unit.contact_email}
            </p>
          ) : null}
        </div>
      ) : null}

      {unit.payment_methods.length > 0 ? (
        <div className="mt-6">
          <h2 className="text-sm font-medium">Payment methods accepted</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {unit.payment_methods
              .map((method) => labelFor(PAYMENT_METHODS, method))
              .join(", ")}
          </p>
        </div>
      ) : null}
    </main>
  );
}
