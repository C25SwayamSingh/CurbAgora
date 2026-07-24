/**
 * Camera state machine for the staff QR scanner, kept separate from the
 * component so every transition — including the ones that are painful to
 * produce in a real browser, like a denied permission or a camera already held
 * by another app — is testable without a camera present.
 *
 * The governing rule: the camera is only ever live in the `scanning` state.
 * Every other state means all MediaStream tracks have been stopped.
 */

export type ScannerStatus =
  "idle" | "requesting" | "scanning" | "denied" | "unavailable" | "error";

export type ScannerState = {
  status: ScannerStatus;
  /** Customer-safe explanation, already worded for a vendor at a counter. */
  message: string | null;
};

export type ScannerEvent =
  | { type: "REQUEST" }
  | { type: "GRANTED" }
  | { type: "DENIED" }
  | { type: "UNAVAILABLE"; reason: CameraUnavailableReason }
  | { type: "FAILED"; reason: string }
  | { type: "CANCEL" }
  | { type: "DECODED" };

export type CameraUnavailableReason =
  "no-camera" | "insecure-context" | "unsupported" | "in-use";

export const INITIAL_SCANNER_STATE: ScannerState = {
  status: "idle",
  message: null,
};

const UNAVAILABLE_MESSAGE: Record<CameraUnavailableReason, string> = {
  "no-camera":
    "No camera found on this device. Enter the 4-digit code instead.",
  "insecure-context":
    "The camera needs a secure (https) connection. Enter the 4-digit code instead.",
  unsupported:
    "This browser can't use the camera. Enter the 4-digit code instead.",
  "in-use":
    "The camera is being used by another app. Close it, or enter the 4-digit code instead.",
};

const DENIED_MESSAGE =
  "Camera access was denied. Enter the customer's four-digit code instead, or enable camera access in your browser settings.";

export function scannerReducer(
  state: ScannerState,
  event: ScannerEvent,
): ScannerState {
  switch (event.type) {
    case "REQUEST":
      // Only reachable from a real tap — never on mount.
      return { status: "requesting", message: null };
    case "GRANTED":
      return { status: "scanning", message: null };
    case "DENIED":
      return { status: "denied", message: DENIED_MESSAGE };
    case "UNAVAILABLE":
      return {
        status: "unavailable",
        message: UNAVAILABLE_MESSAGE[event.reason],
      };
    case "FAILED":
      return { status: "error", message: event.reason };
    case "CANCEL":
    case "DECODED":
      return INITIAL_SCANNER_STATE;
    default:
      return state;
  }
}

/** True exactly when the camera should be running. */
export function isCameraLive(state: ScannerState): boolean {
  return state.status === "scanning";
}

/**
 * The 4-digit path must stay reachable in every camera state — a vendor with a
 * denied permission and a queue forming cannot be left with nothing to do.
 */
export function shouldOfferManualEntry(): boolean {
  return true;
}

/** Map a getUserMedia rejection onto the state machine's vocabulary. */
export function classifyCameraError(error: unknown): ScannerEvent {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { type: "DENIED" };
    case "NotFoundError":
    case "OverconstrainedError":
      return { type: "UNAVAILABLE", reason: "no-camera" };
    case "NotReadableError":
    case "AbortError":
      return { type: "UNAVAILABLE", reason: "in-use" };
    default:
      return {
        type: "FAILED",
        reason: "Couldn't start the camera. Enter the 4-digit code instead.",
      };
  }
}
