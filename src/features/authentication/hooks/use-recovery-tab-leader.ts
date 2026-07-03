"use client";

import * as React from "react";

type TabLeaderState = "pending" | "leader" | "duplicate";

/**
 * Mailpit rewrites email links to `target="_blank"`, which can spawn several
 * tabs for one click. This hook marks duplicate tabs so only one shows the flow.
 * It never opens or closes tabs — Mailpit/browser own that behavior.
 */
export function useRecoveryTabLeader(tokenHash: string | null): TabLeaderState {
  const [state, setState] = React.useState<TabLeaderState>(() =>
    tokenHash ? "pending" : "leader",
  );

  React.useEffect(() => {
    if (!tokenHash) {
      return;
    }

    let cancelled = false;
    const lockName = `curbagora-recovery:${tokenHash}`;

    if (!("locks" in navigator)) {
      queueMicrotask(() => {
        if (!cancelled) {
          setState("leader");
        }
      });
      return () => {
        cancelled = true;
      };
    }

    void navigator.locks.request(
      lockName,
      { mode: "exclusive", ifAvailable: true },
      (lock) => {
        if (cancelled) {
          return Promise.resolve();
        }

        if (!lock) {
          setState("duplicate");
          return Promise.resolve();
        }

        setState("leader");
        return new Promise<void>(() => {
          // Hold until the tab closes or navigates away.
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [tokenHash]);

  if (!tokenHash) {
    return "leader";
  }

  return state;
}
