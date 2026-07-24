"use client";

import * as React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

import type { NearbyVendorLocation } from "@/lib/supabase/database.types";
import {
  STATE_STYLES,
  displayTitle,
  markerAccessibleName,
} from "@/features/discovery/location-state";
import { formatDistance } from "@/features/discovery/components/nearby-location-card";

type LatLng = { lat: number; lng: number };

// The search-center dot. Per-state vendor colours live in STATE_STYLES; the
// Maps JavaScript API needs literal values (CSS variables can't reach the
// canvas), so both mirror the tokens in globals.css by hand.
const CENTER_MARKER_FILL = "#31737A";
const CENTER_MARKER_STROKE = "#FAF5EC";

// Unit-box outlines, scaled at draw time. Distinct silhouettes matter as much
// as colour: a customer with a colour-vision difference, or a phone in direct
// sun, still reads the state from the shape.
const SQUARE_PATH = "M -1 -1 L 1 -1 L 1 1 L -1 1 Z";
const DIAMOND_PATH = "M 0 -1.35 L 1.35 0 L 0 1.35 L -1.35 0 Z";

/**
 * A marker symbol for one result, styled by its state.
 *
 * The hotspot's "hollow" shape is a low-opacity fill with a heavy outline — it
 * reads as *a place*, not *someone is here*, which is the whole point of
 * keeping it visually apart from the vendor pins.
 */
function markerIcon(
  maps: typeof google.maps,
  result: NearbyVendorLocation,
  isSelected: boolean,
): google.maps.Symbol {
  const style = STATE_STYLES[result.state];
  const base = isSelected ? 1.3 : 1;

  if (style.markerShape === "square") {
    return {
      path: SQUARE_PATH,
      scale: 8 * base,
      fillColor: style.markerFill,
      fillOpacity: 1,
      strokeColor: isSelected ? "#31737A" : style.markerStroke,
      strokeWeight: isSelected ? 3 : 1.5,
    };
  }
  if (style.markerShape === "diamond") {
    return {
      path: DIAMOND_PATH,
      scale: 8 * base,
      fillColor: style.markerFill,
      fillOpacity: 1,
      strokeColor: isSelected ? "#31737A" : style.markerStroke,
      strokeWeight: isSelected ? 3 : 1.5,
    };
  }
  if (style.markerShape === "hollow") {
    return {
      path: maps.SymbolPath.CIRCLE,
      scale: 9 * base,
      fillColor: style.markerFill,
      fillOpacity: 0.25,
      strokeColor: style.markerFill,
      strokeWeight: 2.5,
    };
  }
  // circle — LIVE and RECURRING, distinguished by fill.
  return {
    path: maps.SymbolPath.CIRCLE,
    scale: 10 * base,
    fillColor: style.markerFill,
    fillOpacity: 1,
    strokeColor: isSelected ? "#31737A" : style.markerStroke,
    strokeWeight: isSelected ? 3 : 1.5,
  };
}

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
function buildInfoContent(result: NearbyVendorLocation): HTMLElement {
  const root = document.createElement("div");
  root.style.maxWidth = "220px";
  root.style.color = "#1a1a1a";

  const name = document.createElement("p");
  name.textContent = displayTitle(result);
  name.style.fontWeight = "600";
  name.style.margin = "0 0 2px";
  root.appendChild(name);

  const label = document.createElement("p");
  label.textContent = `${result.reason_label} · ${formatDistance(result.distance_miles)}`;
  label.style.margin = "0 0 6px";
  label.style.fontSize = "12px";
  root.appendChild(label);

  // A hotspot has no vendor page to link to — and inventing one would be
  // exactly the "parking zone that looks like a business" failure.
  if (result.organization_slug && result.unit_slug) {
    const link = document.createElement("a");
    link.href = `/vendors/${result.organization_slug}/${result.unit_slug}`;
    link.textContent = "View page";
    link.style.fontSize = "12px";
    link.style.fontWeight = "600";
    root.appendChild(link);
  }

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
  results,
  selectedId,
  onSelect,
}: {
  apiKey: string | null;
  center: LatLng;
  centerLabel: string;
  results: NearbyVendorLocation[];
  selectedId: string | null;
  onSelect: (resultId: string) => void;
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
    for (const result of results) {
      const position = { lat: result.latitude, lng: result.longitude };
      // Keyed by result_id, not vendor_unit_id: a hotspot has no unit, and two
      // states for one vendor never coexist here because the query already
      // collapsed them to the highest-ranked one.
      const isSelected = result.result_id === selectedId;
      const marker = new maps.Marker({
        map,
        position,
        // The accessible name carries the same sentence the card shows, so a
        // screen-reader user is never left decoding a colour.
        title: markerAccessibleName(result),
        icon: markerIcon(maps, result, isSelected),
        zIndex: isSelected ? 900 : 500 - result.rank,
      });
      const id = result.result_id;
      marker.addListener("click", () => onSelect(id));
      markersRef.current.set(id, marker);
      bounds.extend(position);
    }

    // Re-fit only when the SEARCH changes (center/results) — selecting a
    // marker restyles it but must not yank the viewport around.
    const boundsKey = `${center.lat},${center.lng}:${results
      .map((r) => r.result_id)
      .join(",")}`;
    if (boundsKey !== boundsKeyRef.current) {
      boundsKeyRef.current = boundsKey;
      if (results.length > 0) {
        map.fitBounds(bounds, 56);
      } else {
        map.setCenter(center);
        map.setZoom(13);
      }
    }
  }, [status, results, center, centerLabel, onSelect, selectedId]);

  // External selection (a click on a list card) focuses the marker.
  React.useEffect(() => {
    if (status !== "ready" || !selectedId) {
      return;
    }
    const marker = markersRef.current.get(selectedId);
    const result = results.find((r) => r.result_id === selectedId);
    const map = mapRef.current;
    const info = infoRef.current;
    if (!marker || !result || !map || !info) {
      return;
    }
    const position = marker.getPosition();
    if (position) {
      map.panTo(position);
    }
    info.setContent(buildInfoContent(result));
    info.open({ map, anchor: marker });
  }, [selectedId, status, results]);

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
