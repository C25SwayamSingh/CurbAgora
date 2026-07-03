import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAuthContext } from "@/lib/auth/guards";
import { safeNextPath } from "@/lib/auth/redirect";
import { APP_CONFIG, pageTitle } from "@/lib/app-config";
import { SignInForm } from "@/features/authentication/components/sign-in-form";

export const metadata: Metadata = { title: pageTitle("Sign in") };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next, "/onboarding");

  const ctx = await getAuthContext();
  if (ctx) {
    redirect(nextPath);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>
          Sign in to your {APP_CONFIG.name} account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignInForm
          nextPath={nextPath}
          showResetSuccess={params.reset === "success"}
        />
      </CardContent>
    </Card>
  );
}
