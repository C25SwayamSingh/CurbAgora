import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright drives the dev server via 127.0.0.1; allow it to load
  // dev resources (hydration/HMR) cross-origin. Dev-only setting.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
