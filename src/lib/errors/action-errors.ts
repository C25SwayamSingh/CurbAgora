import "server-only";

import { randomUUID } from "crypto";

export type ActionFailureKind =
  | "validation"
  | "authentication"
  | "missing_profile"
  | "authorization"
  | "database"
  | "unexpected";

/** Safe, user-presentable copy keyed by failure kind. */
const USER_MESSAGES: Record<ActionFailureKind, string> = {
  validation: "Please fix the highlighted fields.",
  authentication: "Please sign in again to continue.",
  missing_profile:
    "Your account profile is not ready yet. Sign out, sign back in, and try again. If this keeps happening, contact support with the reference code below.",
  authorization: "You do not have permission to perform this action.",
  database:
    "We could not save your changes right now. Please try again in a moment.",
  unexpected: "Something went wrong. Please try again in a moment.",
};

export type LoggedActionFailure = {
  correlationId: string;
  kind: ActionFailureKind;
  operation: string;
  userId?: string;
  code?: string;
  message?: string;
};

export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Log a structured server-side failure and return a safe ActionState message.
 * In development, appends the correlation ID so local debugging is possible
 * without exposing SQL, tokens, or stack traces in production builds.
 */
export function logActionFailure(
  failure: Omit<LoggedActionFailure, "correlationId"> & {
    correlationId?: string;
  },
): { correlationId: string; userMessage: string } {
  const correlationId = failure.correlationId ?? newCorrelationId();
  console.error("action failed", {
    correlationId,
    kind: failure.kind,
    operation: failure.operation,
    userId: failure.userId,
    code: failure.code,
    message: failure.message,
  });

  const base = USER_MESSAGES[failure.kind];
  const userMessage =
    process.env.NODE_ENV !== "production"
      ? `${base} (ref: ${correlationId.slice(0, 8)})`
      : base;

  return { correlationId, userMessage };
}

/** Map a Supabase/PostgREST error from a profile write to a failure kind. */
export function classifyProfileWriteError(error: {
  code?: string;
  message?: string;
}): ActionFailureKind {
  if (error.code === "42501" || error.message?.includes("permission denied")) {
    return "authorization";
  }
  if (error.code === "PGRST116") {
    return "missing_profile";
  }
  return "database";
}
