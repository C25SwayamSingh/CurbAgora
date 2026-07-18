import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const isGooglePlacesConfiguredMock = vi.hoisted(() => vi.fn());
const autocompleteCitiesMock = vi.hoisted(() => vi.fn());
const resolvePlaceLocationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/geocoding/google-places", () => ({
  isGooglePlacesConfigured: isGooglePlacesConfiguredMock,
  autocompleteCities: autocompleteCitiesMock,
  resolvePlaceLocation: resolvePlaceLocationMock,
}));

import { GET } from "./route";

function request(params: Record<string, string>) {
  const search = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost/api/discover/area?${search}`);
}

describe("GET /api/discover/area", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports unconfigured without hitting Google", async () => {
    isGooglePlacesConfiguredMock.mockReturnValue(false);

    const response = await GET(request({ q: "Austin" }));

    expect(await response.json()).toEqual({ configured: false });
    expect(autocompleteCitiesMock).not.toHaveBeenCalled();
  });

  it("returns suggestions for a query", async () => {
    isGooglePlacesConfiguredMock.mockReturnValue(true);
    autocompleteCitiesMock.mockResolvedValue([
      { placeId: "p1", description: "Austin, TX, USA" },
    ]);

    const response = await GET(request({ q: "Austin" }));
    const body = await response.json();

    expect(body.suggestions).toEqual([
      { placeId: "p1", description: "Austin, TX, USA" },
    ]);
  });

  it("resolves a placeId to coordinates only — never an API key", async () => {
    isGooglePlacesConfiguredMock.mockReturnValue(true);
    resolvePlaceLocationMock.mockResolvedValue({
      latitude: 30.26,
      longitude: -97.74,
    });

    const response = await GET(request({ placeId: "p1" }));
    const body = await response.json();

    expect(body.location).toEqual({ latitude: 30.26, longitude: -97.74 });
    expect(JSON.stringify(body)).not.toMatch(/key/i);
  });

  it("returns 404 for an unresolvable place", async () => {
    isGooglePlacesConfiguredMock.mockReturnValue(true);
    resolvePlaceLocationMock.mockResolvedValue(null);

    const response = await GET(request({ placeId: "bogus" }));

    expect(response.status).toBe(404);
  });

  it("returns empty suggestions for a too-short query", async () => {
    isGooglePlacesConfiguredMock.mockReturnValue(true);

    const response = await GET(request({ q: "a" }));
    const body = await response.json();

    expect(body.suggestions).toEqual([]);
    expect(autocompleteCitiesMock).not.toHaveBeenCalled();
  });
});
