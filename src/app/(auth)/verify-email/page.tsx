import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Verify your email — StreetEats" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  const email = params.email?.slice(0, 254);

  return (
    <Card>
      <CardHeader>
        <MailCheck
          className="mb-2 size-8 text-brand-fresh"
          aria-hidden="true"
        />
        <CardTitle>Check your inbox</CardTitle>
        <CardDescription>
          {email ? (
            <>
              We sent a confirmation link to <strong>{email}</strong>.
            </>
          ) : (
            "We sent a confirmation link to your email address."
          )}{" "}
          Click it to verify your account, then sign in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Didn&apos;t get it? Check your spam folder, or try signing up again in
          a few minutes. The link expires after a short time for your security.
        </p>
        <Button asChild variant="outline">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
