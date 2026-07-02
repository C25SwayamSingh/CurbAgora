/**
 * Open-redirect protection for `next` / redirect params.
 * Only same-origin, absolute-path destinations are accepted.
 */

export function safeNextPath(
  raw: string | null | undefined,
  fallback = "/",
): string {
  if (!raw) {
    return fallback;
  }

  // Must be an absolute path on this origin: "/x" but not "//evil.com",
  // "/\evil.com", "http://evil.com", or paths with embedded backslashes
  // (browsers normalize "\" to "/" which re-enables protocol-relative URLs).
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return fallback;
  }

  try {
    const parsed = new URL(raw, "https://origin.invalid");
    if (parsed.origin !== "https://origin.invalid") {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}
