"use client";

import * as React from "react";
import { List, LocateFixed, Map as MapIcon, RefreshCw } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { NearbyVendorLocation } from "@/lib/supabase/database.types";
import { NearbyMap } from "@/features/discovery/components/nearby-map";
import { NearbyLocationCard } from "@/features/discovery/components/nearby-location-card";
import {
  FILTERS,
  HOTSPOT_EXPLANATION,
  queryFlagsFor,
  type FilterId,
} from "@/features/discovery/location-state";

const RADIUS_OPTIONS = [1, 3, 5, 10] as const;
type RadiusMiles = (typeof RADIUS_OPTIONS)[number];

type SearchCenter = {
  lat: number;
  lng: number;
  label: string;
  source: "device" | "manual";
};

type AreaSuggestion = { placeId: string; description: string };

function flagsToQuery(filter: FilterId): string {
  const f = queryFlagsFor(filter);
  return `live=${f.live}&scheduled=${f.scheduled}&recurring=${f.recurring}&hotspots=${f.hotspots}`;
}

/**
 * Customer discovery across all four location states.
 *
 * Device location is requested ONLY when the customer presses "Use my current
 * location" — never on load — and their coordinates feed one query, never
 * stored. The list works with no Maps script; the map loads lazily. The four
 * states stay visibly distinct, and a hotspot is never shown as a vendor.
 */
export function DiscoverNearby({ mapsApiKey }: { mapsApiKey: string | null }) {
  const [center, setCenter] = React.useState<SearchCenter | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [geoError, setGeoError] = React.useState<string | null>(null);

  const [radius, setRadius] = React.useState<RadiusMiles>(3);
  const [filter, setFilter] = React.useState<FilterId>("all");
  const [results, setResults] = React.useState<NearbyVendorLocation[] | null>(
    null,
  );
  // A separate fetch used only when the main view is empty, so hotspots can be
  // offered as a fallback without ever mixing into the primary vendor results.
  const [fallback, setFallback] = React.useState<NearbyVendorLocation[]>([]);
  const [resultsError, setResultsError] = React.useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = React.useState(0);

  // Loading is DERIVED (search key vs last completed key), never a flag toggled
  // inside the fetch effect — so the two can't fall out of sync.
  const searchKey = center
    ? `${center.lat},${center.lng},${radius},${filter},${refreshNonce}`
    : null;
  const [completedKey, setCompletedKey] = React.useState<string | null>(null);
  const loading = searchKey !== null && searchKey !== completedKey;

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

  // Fetch results whenever the center, radius, filter, or an explicit refresh
  // changes. Aborted on change so a stale response never overwrites a newer one.
  React.useEffect(() => {
    if (!center || !searchKey) {
      return;
    }
    const controller = new AbortController();
    const base = `lat=${center.lat}&lng=${center.lng}&radius=${radius}`;

    fetch(`/api/discover/nearby?${base}&${flagsToQuery(filter)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`nearby lookup failed: ${response.status}`);
        }
        const data = (await response.json()) as {
          results: NearbyVendorLocation[];
        };
        setResults(data.results);
        setResultsError(null);
        setSelectedId(null);

        // Fallback: if the customer's chosen view has nothing, offer nearby
        // hotspots — but only when they weren't already asking for hotspots.
        if (data.results.length === 0 && filter !== "hotspots") {
          try {
            const spotRes = await fetch(
              `/api/discover/nearby?${base}&live=false&scheduled=false&recurring=false&hotspots=true`,
              { signal: controller.signal },
            );
            const spots = (await spotRes.json()) as {
              results: NearbyVendorLocation[];
            };
            setFallback(spots.results ?? []);
          } catch {
            setFallback([]);
          }
        } else {
          setFallback([]);
        }
        setCompletedKey(searchKey);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setResultsError("Couldn't load nearby vendors. Please try again.");
        setCompletedKey(searchKey);
      });
    return () => controller.abort();
  }, [center, radius, filter, refreshNonce, searchKey]);

  function refresh() {
    if (center?.source === "device") {
      requestDeviceLocation();
    }
    setRefreshNonce((n) => n + 1);
  }

  const handleSelect = React.useCallback((resultId: string) => {
    setSelectedId((current) => (current === resultId ? null : resultId));
  }, []);

  const isEmpty = results !== null && results.length === 0;
  const mapData = isEmpty ? fallback : (results ?? []);

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

          {/* State filters — keyboard-reachable, each toggling one state set. */}
          <div
            role="group"
            aria-label="Filter by location status"
            className="flex flex-wrap gap-1.5"
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1 text-sm transition-colors",
                  filter === f.id
                    ? "border-secondary bg-secondary font-medium text-secondary-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
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

          {resultsError && !loading ? (
            <Alert variant="destructive">
              <AlertDescription>{resultsError}</AlertDescription>
            </Alert>
          ) : null}

          {loading && results === null ? (
            <p className="text-sm text-muted-foreground">
              Looking for vendors near you…
            </p>
          ) : null}

          {results !== null ? (
            <>
              {view === "map" && mapData.length > 0 ? (
                <NearbyMap
                  apiKey={mapsApiKey}
                  center={{ lat: center.lat, lng: center.lng }}
                  centerLabel={center.label}
                  results={mapData}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                />
              ) : null}

              {results.length > 0 ? (
                <ul
                  className={cn(
                    "space-y-3",
                    view === "map" ? "max-h-72 overflow-y-auto" : "",
                  )}
                >
                  {results.map((result) => (
                    <NearbyLocationCard
                      key={result.result_id}
                      result={result}
                      selected={selectedId === result.result_id}
                      onSelect={handleSelect}
                    />
                  ))}
                </ul>
              ) : (
                <EmptyState
                  radius={radius}
                  filter={filter}
                  fallback={fallback}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                />
              )}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * What a customer sees when their chosen view is empty. Confirmed vendors are
 * always preferred, so the fallback offers nearby hotspots only — and says
 * plainly that nobody is confirmed there.
 */
function EmptyState({
  radius,
  filter,
  fallback,
  selectedId,
  onSelect,
}: {
  radius: number;
  filter: FilterId;
  fallback: NearbyVendorLocation[];
  selectedId: string | null;
  onSelect: (resultId: string) => void;
}) {
  const noun = filter === "hotspots" ? "food-vendor hotspots" : "vendors";

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-6 text-center">
        <p className="font-medium">
          No {noun} within {radius} {radius === 1 ? "mile" : "miles"} right now.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try a larger radius, a different area, or check back later.
        </p>
      </div>

      {filter !== "hotspots" && fallback.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{HOTSPOT_EXPLANATION}</p>
          <ul className="space-y-3">
            {fallback.map((result) => (
              <NearbyLocationCard
                key={result.result_id}
                result={result}
                selected={selectedId === result.result_id}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
