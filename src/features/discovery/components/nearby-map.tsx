"use client";

import * as React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

import type { NearbyLiveVendor } from "@/lib/supabase/database.types";
import { formatDistance } from "@/features/discovery/components/nearby-vendor-card";

type LatLng = { lat: number; lng: number };

// CurbAgora brand values for map glyphs. The Maps JavaScript API needs
// literal color values (CSS variables can't reach the canvas), so these
// mirror the tokens in globals.css: sunset orange / ink, deep teal / sand.
const VENDOR_MARKER_FILL = "#F67E04";
const VENDOR_MARKER_STROKE = "#241505";
const SELECTED_MARKER_STROKE = "#31737A";
const CENTER_MARKER_FILL = "#31737A";
const CENTER_MARKER_STROKE = "#FAF5EC";

declare global {
  interface Window {
    google?: typeof google;
  }
}

// One shared loader: the Maps JavaScript API script is injected the FIRST
// time the map view actually renders — never on page load — and reused
// after that. A failed load clears the promise so a retry is possible.
let mapsLoaderPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (window.google?.maps?.Map) {
    return Promise.resolve();
  }
  if (!mapsLoaderPromise) {
    mapsLoaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
      script.async = true;
      script.onload = () => {
        if (window.google?.maps?.Map) {
          resolve();
        } else {
          mapsLoaderPromise = null;
          reject(new Error("Google Maps script loaded without maps API"));
        }
      };
      script.onerror = () => {
        mapsLoaderPromise = null;
        script.remove();
        reject(new Error("Google Maps script failed to load"));
      };
      document.head.appendChild(script);
    });
  }
  return mapsLoaderPromise;
}

/** Safe (DOM-built, no innerHTML) info-window content for one vendor. */
function buildInfoContent(vendor: NearbyLiveVendor): HTMLElement {
  const root = document.createElement("div");
  root.style.maxWidth = "220px";
  root.style.color = "#1a1a1a";

  const name = document.createElement("p");
  name.textContent = vendor.name;
  name.style.fontWeight = "600";
  name.style.margin = "0 0 2px";
  root.appendChild(name);

  const label = document.createElement("p");
  label.textContent = `${vendor.public_label} · ${formatDistance(vendor.distance_miles)}`;
  label.style.margin = "0 0 6px";
  label.style.fontSize = "12px";
  root.appendChild(label);

  const link = document.createElement("a");
  link.href = `/vendors/${vendor.organization_slug}/${vendor.unit_slug}`;
  link.textContent = "View page";
  link.style.fontSize = "12px";
  link.style.fontWeight = "600";
  root.appendChild(link);

  return root;
}

/**
 * Interactive Google Map of nearby live vendors. Rendered only when the
 * customer opens Map view; the list view never loads Google's script.
 * Selection flows both ways: clicking a marker calls onSelect (which
 * highlights the list card), and an externally selected vendor pans the
 * map and opens its info window.
 */
export function NearbyMap({
  apiKey,
  center,
  centerLabel,
  vendors,
  selectedId,
  onSelect,
}: {
  apiKey: string | null;
  center: LatLng;
  centerLabel: string;
  vendors: NearbyLiveVendor[];
  selectedId: string | null;
  onSelect: (vendorUnitId: string) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<google.maps.Map | null>(null);
  const infoRef = React.useRef<google.maps.InfoWindow | null>(null);
  const markersRef = React.useRef<Map<string, google.maps.Marker>>(new Map());
  const boundsKeyRef = React.useRef<string>("");
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );

  React.useEffect(() => {
    if (!apiKey) {
      return;
    }
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  // (Re)build the map and its markers whenever data changes.
  React.useEffect(() => {
    if (status !== "ready" || !containerRef.current || !window.google) {
      return;
    }
    const maps = window.google.maps;

    if (!mapRef.current) {
      mapRef.current = new maps.Map(containerRef.current, {
        center,
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      infoRef.current = new maps.InfoWindow();
    }
    const map = mapRef.current;

    for (const marker of markersRef.current.values()) {
      marker.setMap(null);
    }
    markersRef.current.clear();

    // The search center is visually distinct from vendor markers: a small
    // deep-teal dot vs. the larger sunset-orange vendor circles.
    markersRef.current.set(
      "__center__",
      new maps.Marker({
        map,
        position: center,
        title: `Search center: ${centerLabel}`,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: CENTER_MARKER_FILL,
          fillOpacity: 1,
          strokeColor: CENTER_MARKER_STROKE,
          strokeWeight: 2,
        },
        zIndex: 1000,
      }),
    );

    const bounds = new maps.LatLngBounds();
    bounds.extend(center);
    for (const vendor of vendors) {
      const position = { lat: vendor.latitude, lng: vendor.longitude };
      const isSelected = vendor.vendor_unit_id === selectedId;
      const marker = new maps.Marker({
        map,
        position,
        title: `${vendor.name} — ${vendor.public_label}`,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: isSelected ? 13 : 10,
          fillColor: VENDOR_MARKER_FILL,
          fillOpacity: 1,
          strokeColor: isSelected
            ? SELECTED_MARKER_STROKE
            : VENDOR_MARKER_STROKE,
          strokeWeight: isSelected ? 3 : 1.5,
        },
        zIndex: isSelected ? 900 : undefined,
      });
      marker.addListener("click", () => onSelect(vendor.vendor_unit_id));
      markersRef.current.set(vendor.vendor_unit_id, marker);
      bounds.extend(position);
    }

    // Re-fit only when the SEARCH changes (center/results) — selecting a
    // marker restyles it but must not yank the viewport around.
    const boundsKey = `${center.lat},${center.lng}:${vendors
      .map((v) => v.vendor_unit_id)
      .join(",")}`;
    if (boundsKey !== boundsKeyRef.current) {
      boundsKeyRef.current = boundsKey;
      if (vendors.length > 0) {
        map.fitBounds(bounds, 56);
      } else {
        map.setCenter(center);
        map.setZoom(13);
      }
    }
  }, [status, vendors, center, centerLabel, onSelect, selectedId]);

  // External selection (a click on a list card) focuses the marker.
  React.useEffect(() => {
    if (status !== "ready" || !selectedId) {
      return;
    }
    const marker = markersRef.current.get(selectedId);
    const vendor = vendors.find((v) => v.vendor_unit_id === selectedId);
    const map = mapRef.current;
    const info = infoRef.current;
    if (!marker || !vendor || !map || !info) {
      return;
    }
    const position = marker.getPosition();
    if (position) {
      map.panTo(position);
    }
    info.setContent(buildInfoContent(vendor));
    info.open({ map, anchor: marker });
  }, [selectedId, status, vendors]);

  if (!apiKey) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          The map isn&apos;t available right now (missing browser Maps key). The
          list view shows the same vendors.
        </AlertDescription>
      </Alert>
    );
  }

  if (status === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Google Maps failed to load. Check your connection and try again — the
          list view still shows the same vendors.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Map of nearby vendors"
      className="h-[420px] w-full rounded-lg border border-border bg-muted"
    >
      {status === "loading" ? (
        <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading map…
        </p>
      ) : null}
    </div>
  );
}
