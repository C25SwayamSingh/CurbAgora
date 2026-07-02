import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function ListBusinessPage() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        List Your Business
      </h1>
      <p className="mt-2 text-muted-foreground">
        Create a free account, choose the vendor path, and set up your
        organization in a couple of minutes.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link href="/sign-up">Get started</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sign-in">I already have an account</Link>
        </Button>
      </div>
    </main>
  );
}
