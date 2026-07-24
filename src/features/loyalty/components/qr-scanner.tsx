"use client";

import * as React from "react";
import { Camera, Loader2, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { parseCheckoutPayload } from "@/features/loyalty/checkout-code";
import {
  INITIAL_SCANNER_STATE,
  classifyCameraError,
  scannerReducer,
} from "@/features/loyalty/scanner-state";

const SCAN_INTERVAL_MS = 250;

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

/**
 * Camera-based QR scanner for the counter.
 *
 * Two invariants drive the whole component:
 *
 *  1. `getUserMedia` is reached only from an explicit tap. A vendor opening the
 *     checkout screen must never see a permission prompt they didn't ask for.
 *  2. Every path out of scanning stops the tracks. Success, cancel, error,
 *     unmount, and tab-hide all funnel through `stopCamera`, so the camera
 *     light never stays on after the customer walks away.
 *
 * Frames never leave the device: decoding happens locally and only the decoded
 * opaque token is handed to the caller.
 */
export function QrScanner({
  onToken,
  onCancel,
}: {
  onToken: (token: string) => void;
  onCancel: () => void;
}) {
  const [state, dispatch] = React.useReducer(
    scannerReducer,
    INITIAL_SCANNER_STATE,
  );
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const detectorRef = React.useRef<BarcodeDetectorLike | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  // Guards against a second decode firing while the first is still resolving.
  const doneRef = React.useRef(false);

  const stopCamera = React.useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Unmount and navigation are the paths people forget; both land here.
  React.useEffect(() => stopCamera, [stopCamera]);

  React.useEffect(() => {
    function onHidden() {
      if (document.visibilityState === "hidden") {
        stopCamera();
        dispatch({ type: "CANCEL" });
      }
    }
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [stopCamera]);

  function finish(token: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    stopCamera();
    dispatch({ type: "DECODED" });
    onToken(token);
  }

  function cancel() {
    stopCamera();
    dispatch({ type: "CANCEL" });
    onCancel();
  }

  async function decodeFrame() {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || doneRef.current) return;

    if (detectorRef.current) {
      try {
        const results = await detectorRef.current.detect(video);
        for (const result of results) {
          const token = parseCheckoutPayload(result.rawValue);
          if (token) return finish(token);
        }
      } catch {
        // A detector that throws mid-stream (some Android builds do) should
        // degrade to the fallback rather than end the scan.
        detectorRef.current = null;
      }
      return;
    }

    // Fallback path: pull the frame into a canvas and decode in JS. Loaded
    // lazily so browsers with a native detector never download it.
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (!canvas.width || !canvas.height) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const { default: jsQR } = await import("jsqr");
    const found = jsQR(image.data, image.width, image.height, {
      inversionAttempts: "dontInvert",
    });
    if (found) {
      const token = parseCheckoutPayload(found.data);
      if (token) finish(token);
    }
  }

  async function start() {
    doneRef.current = false;
    dispatch({ type: "REQUEST" });

    if (typeof window === "undefined" || !window.isSecureContext) {
      dispatch({ type: "UNAVAILABLE", reason: "insecure-context" });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: "UNAVAILABLE", reason: "unsupported" });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      dispatch({ type: "GRANTED" });

      // Detector construction is deliberately after permission: on some
      // browsers the constructor exists but throws until a stream is live.
      const Detector = (
        window as unknown as {
          BarcodeDetector?: new (opts: {
            formats: string[];
          }) => BarcodeDetectorLike;
        }
      ).BarcodeDetector;
      if (Detector) {
        try {
          detectorRef.current = new Detector({ formats: ["qr_code"] });
        } catch {
          detectorRef.current = null;
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      timerRef.current = setInterval(
        () => void decodeFrame(),
        SCAN_INTERVAL_MS,
      );
    } catch (error) {
      stopCamera();
      dispatch(classifyCameraError(error));
    }
  }

  if (state.status === "scanning" || state.status === "requesting") {
    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-xl border border-border bg-foreground/90">
          <video
            ref={videoRef}
            className="aspect-square w-full object-cover"
            playsInline
            muted
            aria-label="Camera preview for scanning the customer's checkout QR"
          />
          {/* Target frame: gives the vendor somewhere to aim. */}
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden="true"
          >
            <div className="size-2/3 rounded-lg border-4 border-primary/90" />
          </div>
          {state.status === "requesting" ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2
                className="size-8 animate-spin text-background"
                aria-hidden="true"
              />
            </div>
          ) : null}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Point the camera at the customer&apos;s code.
        </p>
        <Button variant="outline" className="w-full" onClick={cancel}>
          <X aria-hidden="true" />
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {state.message ? (
        <Alert variant={state.status === "denied" ? "destructive" : "default"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">
          CurbAgora uses this camera only to scan the customer&apos;s checkout
          QR. Images and video are not saved.
        </p>
      )}
      <Button className="h-14 w-full text-base" onClick={start}>
        <Camera aria-hidden="true" />
        {state.status === "idle" ? "Allow camera and scan" : "Try camera again"}
      </Button>
      <Button variant="ghost" className="w-full" onClick={cancel}>
        Back
      </Button>
    </div>
  );
}
