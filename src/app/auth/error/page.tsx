import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAuthContext } from "@/lib/auth/guards";

export const metadata = { title: "Auth link — CurbAgora" };

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ flow?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  const recoveryFlow = params.flow === "recovery";
  const recoverySessionReady = Boolean(ctx?.user && recoveryFlow);

  const title = recoverySessionReady
    ? "Reset link already opened"
    : recoveryFlow
      ? "This reset link isn\u2019t valid anymore"
      : "This link isn\u2019t valid anymore";

  const description = recoverySessionReady ? (
    <>
      You&apos;re already signed in to finish your password reset. Continue
      below, or use the tab that reached the password form.
    </>
  ) : recoveryFlow ? (
    <>
      Reset links are single-use and expire for your security. If you clicked
      the same email link more than once, request a fresh link below.
    </>
  ) : (
    <>
      The link may have expired or already been used. Email links are single-use
      and expire for your security.
    </>
  );

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {ctx?.user && recoveryFlow ? (
            <Button asChild>
              <Link href="/reset-password">Continue password reset</Link>
            </Button>
          ) : null}
          <Button asChild variant={ctx?.user ? "outline" : "default"}>
            <Link href="/auth/sign-out?next=/sign-in">Go to sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/forgot-password">Request a new reset link</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
