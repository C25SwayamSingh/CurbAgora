import "server-only";

import { networkInterfaces } from "node:os";
import { headers } from "next/headers";

/**
 * The origin to bake into a printed QR code.
 *
 * This is not the same question as "what host served this request". A printed
 * code is scanned by a phone that is not this machine, so `localhost` — the
 * host a developer sees — resolves to the phone itself and fails. The failure
 * is silent and looks like a broken QR rather than a configuration gap, so the
 * caller is told when the link is local-only and can say so on screen.
 */

export type PublicOrigin = {
  origin: string;
  /** True when this link only works on the machine that generated it. */
  localOnly: boolean;
  /**
   * Same-network address to try instead, when there is one. Only populated for
   * a local-only origin — it is a development convenience for testing a scan
   * from a real phone, never something to print.
   */
  lanOrigin: string | null;
};

/** First non-internal IPv4 address, so a phone on the same Wi-Fi can connect. */
function lanAddress(port: string): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return `http://${address.address}:${port}`;
      }
    }
  }
  return null;
}

function isLoopback(host: string): boolean {
  const name = host.split(":")[0]?.toLowerCase() ?? "";
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

export async function publicOrigin(): Promise<PublicOrigin> {
  // An explicit deployment URL always wins: it is the only value that is
  // correct for a code that will outlive this process.
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    const trimmed = configured.replace(/\/+$/, "");
    return { origin: trimmed, localOnly: isLoopback(trimmed), lanOrigin: null };
  }

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (isLoopback(host) ? "http" : "https");
  const localOnly = isLoopback(host);

  return {
    origin: `${protocol}://${host}`,
    localOnly,
    lanOrigin: localOnly ? lanAddress(host.split(":")[1] ?? "3000") : null,
  };
}
