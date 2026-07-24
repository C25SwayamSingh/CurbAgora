"use client";

import * as React from "react";
import { Check, Copy, Download, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { QrCode } from "@/features/loyalty/components/qr-code";
import { qrPath } from "@/features/loyalty/qr";

const PRINT_SIZE_PX = 1024;

/**
 * The permanent, printable QR for one cart.
 *
 * It encodes nothing but a public URL — no token, no org id, no customer data
 * — which is exactly why it can live on a sticker in the weather for a year.
 * It also means scanning it proves nothing about a purchase, so it can never
 * award points on its own.
 */
export function VendorQrPoster({
  url,
  unitName,
}: {
  url: string;
  unitName: string;
}) {
  const [copied, setCopied] = React.useState(false);

  function svgMarkup(): string {
    const path = qrPath(url);
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${path.viewBox}" width="${PRINT_SIZE_PX}" height="${PRINT_SIZE_PX}" shape-rendering="crispEdges">`,
      `<rect width="100%" height="100%" fill="#ffffff"/>`,
      `<path d="${path.d}" fill="#000000"/>`,
      `</svg>`,
    ].join("");
  }

  function download(blob: Blob, filename: string) {
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(href);
  }

  function downloadSvg() {
    download(
      new Blob([svgMarkup()], { type: "image/svg+xml" }),
      `curbagora-${unitName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-qr.svg`,
    );
  }

  // Rasterize through an Image so the PNG is a faithful render of the same
  // vector, rather than a second, subtly different encoding of the URL.
  function downloadPng() {
    const svg = svgMarkup();
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = PRINT_SIZE_PX;
      canvas.height = PRINT_SIZE_PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) {
          download(
            blob,
            `curbagora-${unitName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-qr.png`,
          );
        }
      }, "image/png");
    };
    image.src = `data:image/svg+xml;base64,${window.btoa(svg)}`;
  }

  async function copyLink() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-xs rounded-xl border border-border bg-white p-4">
        <QrCode value={url} label={`Rewards QR code for ${unitName}`} />
        <p className="mt-3 text-center text-sm font-semibold text-black">
          Scan to join rewards
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={downloadPng}>
          <Download aria-hidden="true" />
          Download PNG
        </Button>
        <Button variant="outline" size="sm" onClick={downloadSvg}>
          <Download aria-hidden="true" />
          Download SVG
        </Button>
        <Button variant="outline" size="sm" onClick={copyLink}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" />
            Preview
          </a>
        </Button>
      </div>

      <p className="break-all rounded-md border border-border bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
        {url}
      </p>
    </div>
  );
}
