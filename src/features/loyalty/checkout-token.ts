import "server-only";

import { randomBytes, randomInt, createHash } from "node:crypto";

/**
 * Generation of checkout-session secrets. Server-only on purpose: the raw QR
 * token exists in exactly two places — this process's memory and the
 * customer's own screen. Only its digest is ever written down, so nobody with
 * database access (including us) can reconstruct a scannable code.
 */

/** How many 4-digit candidates to offer the database to pick from. */
const CODE_CANDIDATE_COUNT = 12;

export type CheckoutSecrets = {
  /** Shown to the customer, encoded into their QR. Never persisted. */
  token: string;
  /** Stored. SHA-256 hex of the token. */
  tokenDigest: string;
  /** Candidate 4-digit codes; the database takes the first one free. */
  codeCandidates: string[];
};

export function hashCheckoutToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Only 10,000 four-digit codes exist, so a collision among simultaneously
 * active sessions is a real possibility rather than a theoretical one. Handing
 * the database a list lets it choose deterministically — no retry loop holding
 * a transaction open, and the probability that all twelve are taken is
 * negligible for any realistic number of people queuing at one cart.
 */
export function generateCheckoutSecrets(): CheckoutSecrets {
  const token = randomBytes(32).toString("base64url");
  const codeCandidates: string[] = [];
  while (codeCandidates.length < CODE_CANDIDATE_COUNT) {
    const candidate = String(randomInt(0, 10000)).padStart(4, "0");
    if (!codeCandidates.includes(candidate)) codeCandidates.push(candidate);
  }
  return { token, tokenDigest: hashCheckoutToken(token), codeCandidates };
}
