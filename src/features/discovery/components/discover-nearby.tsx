"use client";

import * as React from "react";
import { List, LocateFixed, Map as MapIcon, RefreshCw } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { NearbyLiveVendor } from "@/lib/supabase/database.types";
import { NearbyMap } from "@/features/discovery/components/nearby-map";
import { NearbyVendorCard } from "@/features/discovery/components/nearby-vendor-card";

const RADIUS_OPTIONS = [1, 3, 5, 10] as const;
type RadiusMiles = (typeof RADIUS_OPTIONS)[number];

type SearchCenter = {
  lat: number;
  lng: number;
  label: string;
  source: "device" | "manual";
};

type AreaSuggestion = { placeId: string; description: string };

/**
 * Customer nearby-vendor discovery. Device location is requested ONLY
 * when the customer explicitly presses "Use my current location" — never
 * on page load — and their coordinates are used for the search query
 * only, never stored. Manual area search is always available (and is the
 * fallback when permission is denied). The Google Maps script loads only
 * when Map view is opened; the list works entirely without it.
 */
export function DiscoverNearby({ mapsApiKey }: { mapsApiKey: string | null }) {
  const [center, setCenter] = React.useState<SearchCenter | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [geoError, setGeoError] = React.useState<string | null>(null);

  const [radius, setRadius] = React.useState<RadiusMiles>(3);
  const [vendors, setVendors] = React.useState<NearbyLiveVendor[] | null>(null);
  const [vendorsError, setVendorsError] = React.useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  // Loading is DERIVED (search key vs last completed key) rather than a
  // flag toggled inside the fetch effect — no setState-in-effect, and no
  // way for the two to fall out of sync.
  const searchKey = center
    ? `${center.lat},${center.lng},${radius},${refreshNonce}`
    : null;
  const [completedKey, setCompletedKey] = React.useState<string | null>(null);
  const vendorsLoading = searchKey !== null && searchKey !== completedKey;

  const [view, setView] = React.useState<"list" | "map">("list");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const [areaQuery, setAreaQuery] = React.useState("");
  const [areaSuggestions, setAreaSuggestions] = React.useState<
    AreaSuggestion[]
  >([]);
  const [areaConfigured, setAreaConfigured] = React.useState(true);
  const [areaError, setAreaError] = React.useState<string | null>(null);
  const areaDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  function requestDeviceLocation() {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError(
        "Your browser doesn't support location — search an area below instead.",
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCenter({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "your current location",
          source: "device",
        });
        setLocating(false);
      },
      (error) => {
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied — no problem, search an area below instead."
            : "Couldn't get your location right now. Try again, or search an area below.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function handleAreaQueryChange(value: string) {
    setAreaQuery(value);
    setAreaError(null);
    if (areaDebounceRef.current) {
      clearTimeout(areaDebounceRef.current);
    }
    if (value.trim().length < 2) {
      setAreaSuggestions([]);
      return;
    }
    areaDebounceRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/discover/area?q=${encodeURIComponent(value)}`,
        );
        const data = (await response.json()) as {
          configured?: boolean;
          suggestions?: AreaSuggestion[];
        };
        if (data.configured === false) {
          setAreaConfigured(false);
          setAreaSuggestions([]);
          return;
        }
        setAreaSuggestions(data.suggestions ?? []);
      } catch {
        setAreaSuggestions([]);
      }
    }, 300);
  }

  async function selectArea(suggestion: AreaSuggestion) {
    setAreaSuggestions([]);
    setAreaQuery(suggestion.description);
    setAreaError(null);
    try {
      const response = await fetch(
        `/api/discover/area?placeId=${encodeURIComponent(suggestion.placeId)}`,
      );
      const data = (await response.json()) as {
        location?: { latitude: number; longitude: number };
      };
      if (!response.ok || !data.location) {
        setAreaError("Couldn't find that area — try a different search.");
        return;
      }
      setCenter({
        lat: data.location.latitude,
        lng: data.location.longitude,
        label: suggestion.description,
        source: "manual",
      });
      setGeoError(null);
    } catch {
      setAreaError("Couldn't find that area — try a different search.");
    }
  }

  // Fetch nearby vendors whenever the search center, radius, or an
  // explicit refresh changes. Aborted on change so stale responses never
  // overwrite newer ones.
  React.useEffect(() => {
    if (!center || !searchKey) {
      return;
    }
    const controller = new AbortController();
    fetch(
      `/api/discover/nearby?lat=${center.lat}&lng=${center.lng}&radius=${radius}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`nearby lookup failed: ${response.status}`);
        }
        const data = (await response.json()) as {
          vendors: NearbyLiveVendor[];
        };
        setVendors(data.vendors);
        setVendorsError(null);
        setSelectedId(null);
        setCompletedKey(searchKey);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setVendorsError("Couldn't load nearby vendors. Please try again.");
        setCompletedKey(searchKey);
      });
    return () => controller.abort();
  }, [center, radius, refreshNonce, searchKey]);

  function refresh() {
    if (center?.source === "device") {
      // Re-acquire the device position too, not just re-query — the
      // customer may have moved since the last search.
      requestDeviceLocation();
    }
    setRefreshNonce((n) => n + 1);
  }

  const handleSelect = React.useCallback((vendorUnitId: string) => {
    setSelectedId((current) =>
      current === vendorUnitId ? null : vendorUnitId,
    );
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-lg border border-border p-4">
        <Button
          type="button"
          onClick={requestDeviceLocation}
          disabled={locating}
          className="w-full sm:w-auto"
        >
          <LocateFixed aria-hidden="true" />
          {locating ? "Finding you…" : "Use my current location"}
        </Button>
        {geoError ? (
          <Alert variant="destructive">
            <AlertDescription>{geoError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="relative">
          <label
            htmlFor="area-search"
            className="mb-1 block text-sm text-muted-foreground"
          >
            Or search a city or neighborhood
          </label>
          <Input
            id="area-search"
            value={areaQuery}
            onChange={(event) => handleAreaQueryChange(event.target.value)}
            placeholder="e.g. East Brunswick"
            autoComplete="off"
            disabled={!areaConfigured}
          />
          {areaSuggestions.length > 0 ? (
            <ul className="absolute z-10 mt-1 w-full rounded-md border border-input bg-background shadow-md">
              {areaSuggestions.map((suggestion) => (
                <li key={suggestion.placeId}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => selectArea(suggestion)}
                  >
                    {suggestion.description}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {!areaConfigured ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Area search isn&apos;t available right now — use your current
              location instead.
            </p>
          ) : null}
          {areaError ? (
            <p className="mt-1 text-sm text-destructive">{areaError}</p>
          ) : null}
        </div>
      </div>

      {center ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Within</span>
            {RADIUS_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRadius(option)}
                aria-pressed={radius === option}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1 text-sm transition-colors",
                  radius === option
                    ? "border-secondary bg-secondary font-medium text-secondary-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                )}
              >
                {option} mi
              </button>
            ))}
            <span className="text-sm text-muted-foreground">
              of {center.label}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={refresh}
              className="ml-auto"
            >
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          </div>

          <div
            role="tablist"
            aria-label="Results view"
            className="inline-flex rounded-lg border border-border p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "list"}
              onClick={() => setView("list")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                view === "list"
                  ? "bg-secondary font-medium text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="size-4" aria-hidden="true" />
              List
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "map"}
              onClick={() => setView("map")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                view === "map"
                  ? "bg-secondary font-medium text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <MapIcon className="size-4" aria-hidden="true" />
              Map
            </button>
          </div>

          {vendorsError && !vendorsLoading ? (
            <Alert variant="destructive">
              <AlertDescription>{vendorsError}</AlertDescription>
            </Alert>
          ) : null}

          {vendorsLoading && vendors === null ? (
            <p className="text-sm text-muted-foreground">
              Looking for vendors near you…
            </p>
          ) : null}

          {vendors !== null ? (
            vendors.length === 0 ? (
              <div className="rounded-lg border border-border p-6 text-center">
                <p className="font-medium">
                  No vendors are live within {radius}{" "}
                  {radius === 1 ? "mile" : "miles"} right now.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a larger radius, a different area, or check back later —
                  vendors appear here the moment they go live.
                </p>
              </div>
            ) : (
              <>
                {view === "map" ? (
                  <NearbyMap
                    apiKey={mapsApiKey}
                    center={{ lat: center.lat, lng: center.lng }}
                    centerLabel={center.label}
                    vendors={vendors}
                    selectedId={selectedId}
                    onSelect={handleSelect}
                  />
                ) : null}
                <ul
                  className={cn(
                    "space-y-3",
                    view === "map" ? "max-h-72 overflow-y-auto" : "",
                  )}
                >
                  {vendors.map((vendor) => (
                    <NearbyVendorCard
                      key={vendor.vendor_unit_id}
                      vendor={vendor}
                      selected={selectedId === vendor.vendor_unit_id}
                      onSelect={handleSelect}
                    />
                  ))}
                </ul>
              </>
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}
