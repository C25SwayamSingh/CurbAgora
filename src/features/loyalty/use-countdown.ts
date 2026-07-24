"use client";

import * as React from "react";

/**
 * Seconds remaining until `expiresAt`, or null when nothing is running.
 *
 * The remaining value is derived during render from a ticking `now` rather
 * than stored in its own state — setting state from inside the interval's
 * effect is what React flags as a synchronous-setState-in-effect, and it also
 * drifts when the tab is backgrounded and timers are throttled. Reading the
 * clock on each render keeps the display honest after a phone unlocks.
 */
export function useCountdown(expiresAt: string | null): number | null {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!expiresAt) return null;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

export function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
