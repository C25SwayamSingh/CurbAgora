import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Invite-link secrets.
 *
 * Same shape as the loyalty checkout token, for the same reason: the raw value
 * exists only in the owner's hands, and only its digest is written down. A
 * database reader — including us — cannot reconstruct a working link.
 *
 * The token alone is not sufficient to join. Accepting also requires being
 * signed in as the invited email address, so a link that ends up in the wrong
 * chat thread is inert.
 */

export type InvitationSecret = { token: string; tokenDigest: string };

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateInvitationSecret(): InvitationSecret {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenDigest: hashInvitationToken(token) };
}

/** 43 base64url characters — what `randomBytes(32)` always produces. */
export function isValidInvitationToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
