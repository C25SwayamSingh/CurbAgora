import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, Users } from "lucide-react";

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
import { previewInvitationAction } from "@/features/organizations/invitation-actions";
import { AcceptInvitation } from "@/features/organizations/components/accept-invitation";

export const metadata: Metadata = { title: pageTitle("Join a team") };

const ROLE_SUMMARY: Record<string, string> = {
  staff: "take checkout and award points",
  manager: "take checkout, and change rewards and the team",
  owner: "full control of the business account",
};

/**
 * Where an invite link lands.
 *
 * Readable signed out on purpose — someone told "here's your link" needs to be
 * able to see what it is and be sent to sign up. It shows only the business
 * name and the role; the roster, the customer list, and every other member
 * stay invisible until they are actually on the team.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const preview = await previewInvitationAction(token);

  const shell = (children: React.ReactNode) => (
    <main className="mx-auto flex min-h-svh max-w-md items-center px-4 py-10">
      <div className="w-full">{children}</div>
    </main>
  );

  if (preview.outcome === "not_found") {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">This link doesn&apos;t work</CardTitle>
          <CardDescription>
            It may have been cancelled, or copied incompletely. Ask whoever
            invited you to send a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/">Go to CurbAgora</Link>
          </Button>
        </CardContent>
      </Card>,
    );
  }

  const org = preview.organizationName ?? "a business";
  const roleText = preview.role ? ROLE_SUMMARY[preview.role] : "";

  if (preview.outcome === "already_accepted") {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Already used</CardTitle>
          <CardDescription>
            This invitation to {org} has already been accepted. If that was you,
            sign in and you&apos;ll find it on your vendor dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/vendor">Go to the dashboard</Link>
          </Button>
        </CardContent>
      </Card>,
    );
  }

  if (preview.outcome === "revoked" || preview.outcome === "expired") {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {preview.outcome === "expired"
              ? "This invitation expired"
              : "This invitation was cancelled"}
          </CardTitle>
          <CardDescription>Ask {org} to send you a new link.</CardDescription>
        </CardHeader>
      </Card>,
    );
  }

  if (preview.outcome === "sign_in_required") {
    // The email is shown because they must use exactly this address, and they
    // are the person it was sent to — they already know it.
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="size-5 text-brand" aria-hidden="true" />
            Join {org}
          </CardTitle>
          <CardDescription>
            You&apos;ve been invited to help run {org} on CurbAgora —
            you&apos;ll be able to {roleText}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert>
            <AlertCircle aria-hidden="true" />
            <AlertDescription>
              Sign in or create your account using{" "}
              <strong>{preview.invitedEmail}</strong>. This invitation only
              works for that address.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/sign-up?next=/invite/${token}`}>
                Create my account
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/sign-in?next=/invite/${token}`}>
                I already have one
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>,
    );
  }

  if (preview.outcome === "wrong_account") {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Signed in as someone else</CardTitle>
          <CardDescription>
            This invitation was sent to <strong>{preview.invitedEmail}</strong>,
            but you&apos;re signed in with a different account. Sign out and
            come back to this link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/auth/sign-out">Sign out</Link>
          </Button>
        </CardContent>
      </Card>,
    );
  }

  return shell(
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="size-5 text-brand" aria-hidden="true" />
          Join {org}
        </CardTitle>
        <CardDescription>You&apos;ll be able to {roleText}.</CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptInvitation token={token} organizationName={org} />
      </CardContent>
    </Card>,
  );
}
