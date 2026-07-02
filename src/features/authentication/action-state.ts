/**
 * Shared result shape for form server actions, consumed by useActionState.
 * Only safe, user-presentable messages are ever placed in `message` —
 * raw database or auth errors are logged server-side, not surfaced.
 */

export type FieldErrors = Record<string, string[] | undefined>;

export type ActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: FieldErrors;
};

export const idleState: ActionState = { status: "idle" };

export function errorState(
  message: string,
  fieldErrors?: FieldErrors,
): ActionState {
  return { status: "error", message, fieldErrors };
}

export function successState(message?: string): ActionState {
  return { status: "success", message };
}
