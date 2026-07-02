"use client";

import { signOutAction } from "@/features/authentication/actions";
import { SubmitButton } from "@/features/authentication/components/submit-button";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <SubmitButton variant="ghost" size="sm" pendingLabel="Signing out…">
        Sign out
      </SubmitButton>
    </form>
  );
}
