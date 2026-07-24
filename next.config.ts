import type { NextConfig } from "next";

// Allow next/image to optimize vendor photos served from Supabase Storage.
// Derived from the (public) Supabase URL so local dev, staging, and
// production each allow exactly their own storage host — nothing broader.
const remotePatterns: NonNullable<
  NonNullable<NextConfig["images"]>["remotePatterns"]
> = [];
// The local Supabase stack serves storage from 127.0.0.1, which the image
// optimizer's SSRF guard blocks by default. Only lifted when the
// configured Supabase host IS loopback (i.e. local development) — a real
// deployment points at a public Supabase host and keeps the guard.
let supabaseIsLoopback = false;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (supabaseUrl) {
  try {
    const url = new URL(supabaseUrl);
    remotePatterns.push({
      protocol: url.protocol === "http:" ? "http" : "https",
      hostname: url.hostname,
      port: url.port,
      pathname: "/storage/v1/object/public/vendor-photos/**",
    });
    supabaseIsLoopback =
      url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    // Malformed URL is surfaced by src/lib/supabase/env.ts at runtime.
  }
}

const nextConfig: NextConfig = {
  // Playwright drives the dev server via 127.0.0.1; allow it to load
  // dev resources (hydration/HMR) cross-origin. Dev-only setting.
  //
  // Private LAN ranges are allowed too so a real phone can open the dev server
  // to test a scanned QR. Without this, the page loads but every dev-time
  // request it makes is rejected as cross-origin, which looks like a broken
  // button rather than a configuration gap. These patterns cover only
  // RFC-1918 addresses — nothing routable from outside the local network — and
  // `allowedDevOrigins` has no effect on a production build.
  allowedDevOrigins: [
    "127.0.0.1",
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.2*.*.*",
    "172.30.*.*",
    "172.31.*.*",
  ],
  images: {
    remotePatterns,
    ...(supabaseIsLoopback ? { dangerouslyAllowLocalIP: true } : {}),
  },
  experimental: {
    serverActions: {
      // Default is 1MB; vendor photo uploads allow up to 5MB files
      // (validated app-side and enforced again by the storage bucket).
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
