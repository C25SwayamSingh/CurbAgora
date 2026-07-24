import { describe, expect, it } from "vitest";

import {
  INITIAL_SCANNER_STATE,
  classifyCameraError,
  isCameraLive,
  scannerReducer,
  shouldOfferManualEntry,
  type ScannerState,
} from "@/features/loyalty/scanner-state";

function run(events: Parameters<typeof scannerReducer>[1][]): ScannerState {
  return events.reduce(scannerReducer, INITIAL_SCANNER_STATE);
}

describe("scanner lifecycle", () => {
  it("starts idle with the camera off", () => {
    expect(INITIAL_SCANNER_STATE.status).toBe("idle");
    expect(isCameraLive(INITIAL_SCANNER_STATE)).toBe(false);
  });

  it("only goes live after an explicit request is granted", () => {
    expect(isCameraLive(run([{ type: "REQUEST" }]))).toBe(false);
    expect(isCameraLive(run([{ type: "REQUEST" }, { type: "GRANTED" }]))).toBe(
      true,
    );
  });

  it("turns the camera off on a successful decode", () => {
    const state = run([
      { type: "REQUEST" },
      { type: "GRANTED" },
      { type: "DECODED" },
    ]);
    expect(isCameraLive(state)).toBe(false);
    expect(state.status).toBe("idle");
  });

  it("turns the camera off when staff cancels", () => {
    const state = run([
      { type: "REQUEST" },
      { type: "GRANTED" },
      { type: "CANCEL" },
    ]);
    expect(isCameraLive(state)).toBe(false);
  });

  it("leaves the camera off in every failure state", () => {
    const failures: Parameters<typeof scannerReducer>[1][] = [
      { type: "DENIED" },
      { type: "UNAVAILABLE", reason: "no-camera" },
      { type: "UNAVAILABLE", reason: "in-use" },
      { type: "FAILED", reason: "boom" },
    ];
    for (const failure of failures) {
      const state = run([{ type: "REQUEST" }, failure]);
      expect(isCameraLive(state)).toBe(false);
      expect(state.message).toBeTruthy();
    }
  });
});

describe("fallback messaging", () => {
  it("points a denied vendor at the 4-digit code and at their settings", () => {
    const state = run([{ type: "REQUEST" }, { type: "DENIED" }]);
    expect(state.message).toMatch(/four-digit code/i);
    expect(state.message).toMatch(/browser settings/i);
  });

  it("names the 4-digit fallback in every unavailable reason", () => {
    for (const reason of [
      "no-camera",
      "insecure-context",
      "unsupported",
      "in-use",
    ] as const) {
      const state = run([{ type: "REQUEST" }, { type: "UNAVAILABLE", reason }]);
      expect(state.message).toMatch(/4-digit code/i);
    }
  });

  it("never strands the vendor without a manual option", () => {
    expect(shouldOfferManualEntry()).toBe(true);
  });
});

describe("classifyCameraError", () => {
  it("treats a refused permission as denial, not a crash", () => {
    expect(classifyCameraError({ name: "NotAllowedError" })).toEqual({
      type: "DENIED",
    });
    expect(classifyCameraError({ name: "SecurityError" })).toEqual({
      type: "DENIED",
    });
  });

  it("distinguishes no camera from a camera another app holds", () => {
    expect(classifyCameraError({ name: "NotFoundError" })).toEqual({
      type: "UNAVAILABLE",
      reason: "no-camera",
    });
    expect(classifyCameraError({ name: "NotReadableError" })).toEqual({
      type: "UNAVAILABLE",
      reason: "in-use",
    });
  });

  it("falls back to a controlled failure for anything unrecognized", () => {
    const event = classifyCameraError(new Error("something odd"));
    expect(event.type).toBe("FAILED");
    expect(event).toHaveProperty("reason", expect.stringMatching(/4-digit/i));
  });

  it("survives a non-error rejection value", () => {
    expect(classifyCameraError(undefined).type).toBe("FAILED");
    expect(classifyCameraError("nope").type).toBe("FAILED");
  });
});
