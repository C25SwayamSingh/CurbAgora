"use client";

import * as React from "react";

import { qrPath } from "@/features/loyalty/qr";
import { cn } from "@/lib/utils";

/**
 * A QR rendered as one SVG path on a plain card surface.
 *
 * `shapeRendering="crispEdges"` matters more than it looks: without it,
 * browsers antialias module edges and a phone camera reads a blurred boundary,
 * which is exactly the failure that makes people give up on scanning and read
 * the code aloud instead.
 *
 * The light background is fixed rather than themed. Scanners expect dark
 * modules on light, and inverting them in dark mode makes many decoders —
 * including iOS Camera — refuse the code outright.
 */
export function QrCode({
  value,
  className,
  label,
}: {
  value: string;
  className?: string;
  label: string;
}) {
  const path = React.useMemo(() => qrPath(value), [value]);

  return (
    <svg
      viewBox={path.viewBox}
      className={cn("h-auto w-full max-w-full rounded-md bg-white", className)}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <path d={path.d} fill="#000000" />
    </svg>
  );
}
