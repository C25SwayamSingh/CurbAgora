/**
 * Customer discovery behaviour across the four location states.
 *
 * Covers the privacy invariants (device location only on explicit action, list
 * works with no Maps script) AND the location-intelligence requirements: the
 * states render distinctly, filters drive the query, a hotspot never looks like
 * a vendor, and an empty view falls back to hotspots with honest wording.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiscoverNearby } from "@/features/discovery/components/discover-nearby";
import type {
  LocationState,
  NearbyVendorLocation,
} from "@/lib/supabase/database.types";

const getCurrentPositionMock = vi.fn();
const fetchMock = vi.fn();

function makeResult(
  state: LocationState,
  overrides: Partial<NearbyVendorLocation> = {},
): NearbyVendorLocation {
  const vendorish = state !== "HOTSPOT";
  return {
    result_id: `${state}:1`,
    state,
    rank: 1,
    vendor_unit_id: vendorish ? "unit-1" : null,
    organization_slug: vendorish ? "taco-cart" : null,
    unit_slug: vendorish ? "taco-cart" : null,
    name: vendorish ? "Maria's Taco Cart" : null,
    unit_type: vendorish ? "food_cart" : null,
    cuisine_categories: vendorish ? ["mexican"] : null,
    primary_image_path: null,
    latitude: 30.27,
    longitude: -97.74,
    public_label: vendorish ? "Corner of 5th & Main" : "Permitted vending zone",
    reason_label: {
      LIVE: "Live — confirmed 4 minutes ago",
      SCHEDULED_NOW: "Scheduled now, until 2:00 PM",
      RECURRING_NOW: "Usually here weekdays, 11 AM–3 PM",
      SCHEDULED_UPCOMING: "Scheduled tomorrow, 5:00 PM–9:00 PM",
      HOTSPOT: "Food-vendor hotspot — vendor not confirmed",
    }[state],
    source_type: vendorish ? "VENDOR_LIVE" : "MUNICIPAL_OPEN_DATA",
    verification: "CONFIRMED",
    last_verified_at: new Date().toISOString(),
    starts_at: null,
    ends_at: null,
    distance_miles: 0.4,
    ...overrides,
  };
}

/**
 * Route the fetch mock by URL: the hotspot fallback query (hotspots=true, all
 * else false) returns `hotspots`; everything else returns `main`. Anything not
 * a discovery call resolves empty.
 */
function mockNearby(
  main: NearbyVendorLocation[],
  hotspots: NearbyVendorLocation[] = [],
) {
  fetchMock.mockImplementation(async (url: string) => {
    const s = String(url);
    if (s.includes("/api/discover/nearby")) {
      const isHotspotOnly =
        s.includes("hotspots=true") && s.includes("live=false");
      return {
        ok: true,
        json: async () => ({ results: isHotspotOnly ? hotspots : main }),
      };
    }
    return { ok: true, json: async () => ({ suggestions: [] }) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition: getCurrentPositionMock },
    configurable: true,
  });
  vi.stubGlobal("fetch", fetchMock);
  mockNearby([makeResult("LIVE")]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function grantPosition() {
  getCurrentPositionMock.mockImplementation(
    (success: (position: unknown) => void) => {
      success({ coords: { latitude: 30.26, longitude: -97.75 } });
    },
  );
}

async function search() {
  grantPosition();
  await userEvent.click(
    screen.getByRole("button", { name: /use my current location/i }),
  );
}

describe("privacy and lazy loading", () => {
  it("requests device location only on explicit action", async () => {
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    expect(getCurrentPositionMock).not.toHaveBeenCalled();
    await search();
    expect(getCurrentPositionMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to manual area search when permission is denied", async () => {
    getCurrentPositionMock.mockImplementation(
      (_s: unknown, errorCallback: (error: unknown) => void) => {
        errorCallback({ code: 1, PERMISSION_DENIED: 1 });
      },
    );
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    await userEvent.click(
      screen.getByRole("button", { name: /use my current location/i }),
    );
    expect(
      await screen.findByText(/location permission was denied/i),
    ).toBeDefined();
    expect(
      screen.getByLabelText(/search a city or neighborhood/i),
    ).toBeDefined();
  });

  it("shows results in list view without loading the Maps script", async () => {
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    await search();
    expect(await screen.findByText("Maria's Taco Cart")).toBeDefined();
    expect(
      document.querySelector('script[src*="maps.googleapis.com"]'),
    ).toBeNull();
  });

  it("keeps the list working when Maps has no browser key", async () => {
    render(<DiscoverNearby mapsApiKey={null} />);
    await search();
    await screen.findByText("Maria's Taco Cart");
    await userEvent.click(screen.getByRole("tab", { name: /map/i }));
    expect(await screen.findByText(/missing browser maps key/i)).toBeDefined();
    expect(screen.getByText("Maria's Taco Cart")).toBeDefined();
    expect(
      document.querySelector('script[src*="maps.googleapis.com"]'),
    ).toBeNull();
  });
});

describe("the four states render distinctly", () => {
  it("labels a live vendor as live", async () => {
    mockNearby([makeResult("LIVE")]);
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    await search();
    // Scope to the card: "Live now" is also a filter-chip label.
    const card = await screen.findByRole("button", {
      name: /maria's taco cart/i,
    });
    expect(within(card).getByText("Live now")).toBeDefined();
    expect(within(card).getByText(/confirmed 4 minutes ago/i)).toBeDefined();
  });

  it("labels a recurring result 'Usually here', never live", async () => {
    mockNearby([makeResult("RECURRING_NOW")]);
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    await search();
    const card = await screen.findByRole("button", {
      name: /maria's taco cart/i,
    });
    expect(within(card).getByText("Usually here")).toBeDefined();
    expect(within(card).queryByText("Live now")).toBeNull();
  });

  it("distinguishes scheduled-now from upcoming", async () => {
    mockNearby([makeResult("SCHEDULED_UPCOMING")]);
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    await search();
    expect(await screen.findByText("Upcoming")).toBeDefined();
    expect(screen.getByText(/scheduled tomorrow/i)).toBeDefined();
  });
});

describe("hotspots are never vendors", () => {
  it("shows a hotspot with no vendor identity or page link", async () => {
    // Default view lists the live vendor; the hotspot only appears once the
    // customer asks for it — the same request the empty-view fallback makes.
    mockNearby([makeResult("LIVE")], [makeResult("HOTSPOT")]);
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    await search();
    await userEvent.click(screen.getByRole("button", { name: "Hotspots" }));

    const card = await screen.findByRole("button", {
      name: /permitted vending zone/i,
    });
    const scope = within(card);
    expect(scope.getByText(/vendor not confirmed/i)).toBeDefined();
    // No invented business name, no "View page" link.
    expect(scope.queryByText("Maria's Taco Cart")).toBeNull();
    expect(scope.queryByText(/view page/i)).toBeNull();
    expect(card.textContent).not.toMatch(/\bopen\b/i);
    expect(card.textContent).not.toMatch(/\blive\b/i);
  });

  it("offers hotspots as a fallback, with honest wording, when empty", async () => {
    mockNearby([], [makeResult("HOTSPOT")]);
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    await search();
    expect(
      await screen.findByText(/none are confirmed right now/i),
    ).toBeDefined();
    expect(screen.getByText("Permitted vending zone")).toBeDefined();
  });
});

describe("filters", () => {
  it("offers all five and drives the query", async () => {
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    await search();
    await screen.findByText("Maria's Taco Cart");

    for (const label of [
      "All",
      "Live now",
      "Scheduled",
      "Usually here",
      "Hotspots",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }

    await userEvent.click(screen.getByRole("button", { name: "Live now" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) =>
        String(u).includes("recurring=false&hotspots=false"),
      );
      expect(String(call?.[0])).toContain("live=true");
    });
  });

  it("keeps the radius and coordinates in the query", async () => {
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    await search();
    await screen.findByText("Maria's Taco Cart");
    const call = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/api/discover/nearby"),
    );
    expect(String(call?.[0])).toContain("lat=30.26");
    expect(String(call?.[0])).toContain("radius=3");
  });
});

describe("map and list selection stay in sync", () => {
  it("marks a card selected on click", async () => {
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    await search();
    const card = await screen.findByRole("button", {
      name: /maria's taco cart/i,
    });
    expect(card.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
  });
});
