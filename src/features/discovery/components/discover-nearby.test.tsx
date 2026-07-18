/**
 * Privacy and lazy-loading behavior of customer discovery: device
 * location is requested only on explicit action, denial falls back to
 * manual area search, the list works without Google Maps, and the Maps
 * script is never injected while in list view / without a key.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiscoverNearby } from "@/features/discovery/components/discover-nearby";
import type { NearbyLiveVendor } from "@/lib/supabase/database.types";

const getCurrentPositionMock = vi.fn();
const fetchMock = vi.fn();

const vendor: NearbyLiveVendor = {
  vendor_unit_id: "unit-1",
  organization_id: "org-1",
  organization_slug: "taco-cart",
  unit_slug: "taco-cart",
  name: "Maria's Taco Cart",
  unit_type: "food_cart",
  cuisine_categories: ["mexican"],
  city: "Austin",
  state: "TX",
  neighborhood: null,
  primary_image_path: null,
  operating_status: "open",
  latitude: 30.27,
  longitude: -97.74,
  public_label: "Corner of 5th & Main",
  started_at: new Date().toISOString(),
  expected_end_at: null,
  distance_miles: 0.4,
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition: getCurrentPositionMock },
    configurable: true,
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ vendors: [vendor] }),
  });
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

describe("DiscoverNearby", () => {
  it("never requests device location on page load — only on explicit action", async () => {
    render(<DiscoverNearby mapsApiKey="browser-key" />);
    expect(getCurrentPositionMock).not.toHaveBeenCalled();

    grantPosition();
    await userEvent.click(
      screen.getByRole("button", { name: /use my current location/i }),
    );
    expect(getCurrentPositionMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to manual area search when permission is denied", async () => {
    getCurrentPositionMock.mockImplementation(
      (_success: unknown, errorCallback: (error: unknown) => void) => {
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

  it("shows nearby results in list view WITHOUT loading the Google Maps script", async () => {
    grantPosition();
    render(<DiscoverNearby mapsApiKey="browser-key" />);

    await userEvent.click(
      screen.getByRole("button", { name: /use my current location/i }),
    );

    expect(await screen.findByText("Maria's Taco Cart")).toBeDefined();
    expect(screen.getByText(/0\.4 mi/)).toBeDefined();
    expect(screen.getByText(/corner of 5th & main/i)).toBeDefined();
    expect(
      document.querySelector('script[src*="maps.googleapis.com"]'),
    ).toBeNull();
  });

  it("requests vendors with the selected radius and search coordinates", async () => {
    grantPosition();
    render(<DiscoverNearby mapsApiKey="browser-key" />);

    await userEvent.click(
      screen.getByRole("button", { name: /use my current location/i }),
    );
    await screen.findByText("Maria's Taco Cart");

    const nearbyCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/api/discover/nearby"),
    );
    expect(String(nearbyCall?.[0])).toContain("lat=30.26");
    expect(String(nearbyCall?.[0])).toContain("lng=-97.75");
    expect(String(nearbyCall?.[0])).toContain("radius=3");

    await userEvent.click(screen.getByRole("button", { name: "10 mi" }));
    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(String(lastCall?.[0])).toContain("radius=10");
    });
  });

  it("map view without a browser key shows a clear fallback, list keeps working", async () => {
    grantPosition();
    render(<DiscoverNearby mapsApiKey={null} />);

    await userEvent.click(
      screen.getByRole("button", { name: /use my current location/i }),
    );
    await screen.findByText("Maria's Taco Cart");

    await userEvent.click(screen.getByRole("tab", { name: /map/i }));

    expect(await screen.findByText(/missing browser maps key/i)).toBeDefined();
    // The list stays rendered alongside the fallback.
    expect(screen.getByText("Maria's Taco Cart")).toBeDefined();
    expect(
      document.querySelector('script[src*="maps.googleapis.com"]'),
    ).toBeNull();
  });

  it("shows the empty state when no vendors are live nearby", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ vendors: [] }),
    });
    grantPosition();
    render(<DiscoverNearby mapsApiKey="browser-key" />);

    await userEvent.click(
      screen.getByRole("button", { name: /use my current location/i }),
    );

    expect(
      await screen.findByText(/no vendors are live within 3 miles/i),
    ).toBeDefined();
  });

  it("selecting a list card marks it selected (marker correspondence)", async () => {
    grantPosition();
    render(<DiscoverNearby mapsApiKey="browser-key" />);

    await userEvent.click(
      screen.getByRole("button", { name: /use my current location/i }),
    );
    const card = await screen.findByRole("button", {
      name: /maria's taco cart/i,
    });

    expect(card.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
  });
});
