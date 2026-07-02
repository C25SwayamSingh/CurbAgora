import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function DiscoverPage() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Find Vendors</h1>
      <p className="mt-2 text-muted-foreground">
        Customer discovery is coming in a future phase. Map and live-location
        features are not yet available.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Back to home</Link>
      </Button>
    </main>
  );
}
