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
import { SignUpForm } from "@/features/authentication/components/sign-up-form";

export const metadata: Metadata = { title: "Create account — CurbAgora" };

export default async function SignUpPage() {
  const ctx = await getAuthContext();
  if (ctx) {
    redirect("/onboarding");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Order-of-magnitude better street food discovery — or more customers
          for your cart, truck, or stand.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignUpForm />
      </CardContent>
    </Card>
  );
}
