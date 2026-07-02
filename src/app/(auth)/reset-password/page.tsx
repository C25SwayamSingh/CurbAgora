import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAuth } from "@/lib/auth/guards";
import { ResetPasswordForm } from "@/features/authentication/components/reset-password-form";

export const metadata: Metadata = { title: "Set new password — StreetEats" };

export default async function ResetPasswordPage() {
  // A recovery session (from the email link) is required to set a password.
  await requireAuth("/reset-password");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>
          Choose a new password for your account. You&apos;ll use it the next
          time you sign in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}
