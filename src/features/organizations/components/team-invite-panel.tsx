"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, Check, Copy, UserPlus, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { idleState } from "@/features/authentication/action-state";
import { SubmitButton } from "@/features/authentication/components/submit-button";
import {
  createInvitationAction,
  revokeInvitationAction,
} from "@/features/organizations/invitation-actions";
import type { OrganizationRole } from "@/lib/supabase/database.types";

export type PendingInvitation = {
  id: string;
  email: string;
  firstName: string;
  role: OrganizationRole;
  expiresAt: string;
};

/**
 * Invite by email, send the link yourself.
 *
 * CurbAgora deliberately does not send the mail: doing so would require a
 * service-role credential that bypasses every RLS policy, which is a large
 * secret to introduce so a two-person cart can add one person. The owner
 * already has a way to reach them.
 *
 * The link is shown exactly once. It is not recoverable afterward — only its
 * digest is stored — so an owner who loses it issues a new one, which retires
 * the old.
 */
export function TeamInvitePanel({
  canInviteOwner,
  pending,
}: {
  canInviteOwner: boolean;
  pending: PendingInvitation[];
}) {
  const [state, formAction] = useActionState(createInvitationAction, idleState);
  const [revokeState, revokeAction] = useActionState(
    revokeInvitationAction,
    idleState,
  );
  const [copied, setCopied] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  // The action packs "<label>|<url>" so the link can be rendered for copying
  // rather than buried in a sentence.
  const [linkLabel, link] =
    state.status === "success" && state.message?.includes("|")
      ? state.message.split("|")
      : [null, null];

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-3">
      {pending.length > 0 ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Waiting to join
          </p>
          <ul className="mt-1 space-y-1.5">
            {pending.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{invite.firstName}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {invite.email} · {invite.role}
                  </span>
                </span>
                <form action={revokeAction}>
                  <input type="hidden" name="invitationId" value={invite.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    <X aria-hidden="true" />
                    Cancel
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {revokeState.status === "error" && revokeState.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{revokeState.message}</AlertDescription>
        </Alert>
      ) : null}

      {link ? (
        <div className="rounded-lg border border-secondary bg-accent/30 p-3">
          <p className="text-sm font-medium">{linkLabel}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Send this to them however you normally talk. It works once, expires
            in 7 days, and only opens for the email address you entered.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs">
              {link}
            </code>
            <Button size="sm" onClick={copyLink}>
              {copied ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            You won&apos;t be able to see this link again — copy it now.
          </p>
        </div>
      ) : null}

      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {open ? (
        <form action={formAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-first-name">First name</Label>
              <Input
                id="invite-first-name"
                name="firstName"
                placeholder="Jose"
                autoComplete="off"
                maxLength={60}
              />
              <p className="text-xs text-muted-foreground">
                So you can tell who did what.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Their email</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                inputMode="email"
                placeholder="jose@example.com"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Check this carefully — the link only works for this address.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">What can they do?</Label>
            <Select id="invite-role" name="role" defaultValue="staff">
              <option value="staff">
                Staff — take checkout and award points
              </option>
              <option value="manager">
                Manager — also change rewards and the team
              </option>
              {canInviteOwner ? (
                <option value="owner">Owner — full control</option>
              ) : null}
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel="Creating link…">
              Create invite link
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <UserPlus aria-hidden="true" />
          Invite someone
        </Button>
      )}
    </div>
  );
}
