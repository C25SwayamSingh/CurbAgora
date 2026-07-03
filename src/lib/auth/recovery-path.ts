/**
 * Converts a recovery URL from Mailpit into a same-origin app path for
 * in-tab navigation (no `window.open`, no `target="_blank"`).
 */
export function sameOriginRecoveryPath(resetUrl: string): string | null {
  try {
    const url = new URL(resetUrl);
    if (url.pathname !== "/auth/recovery") {
      return null;
    }
    if (url.searchParams.get("type") !== "recovery") {
      return null;
    }
    if (!url.searchParams.get("token_hash")) {
      return null;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
