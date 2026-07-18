import type { Metadata } from "next";
import Link from "next/link";

import { pageTitle } from "@/lib/app-config";
import { DiscoverNearby } from "@/features/discovery/components/discover-nearby";

export const metadata: Metadata = {
  title: pageTitle("Find vendors near you"),
};

export default function DiscoverPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← CurbAgora
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Find vendors near you
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        See carts, trucks, and stands that are live right now. Your location is
        only used when you ask, only for this search, and never stored.
      </p>
      <div className="mt-6">
        <DiscoverNearby
          mapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null}
        />
      </div>
    </main>
  );
}
