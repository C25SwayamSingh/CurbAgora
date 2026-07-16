import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const getAuthContextMock = vi.hoisted(() => vi.fn());
const isGooglePlacesConfiguredMock = vi.hoisted(() => vi.fn());
const autocompleteCitiesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/guards", () => ({
  getAuthContext: getAuthContextMock,
}));
vi.mock("@/lib/geocoding/google-places", () => ({
  isGooglePlacesConfigured: isGooglePlacesConfiguredMock,
  autocompleteCities: autocompleteCitiesMock,
}));

import { GET } from "./route";

function request(query?: string) {
  const url = query
    ? `http://localhost/api/geocoding/city-autocomplete?q=${encodeURIComponent(query)}`
    : "http://localhost/api/geocoding/city-autocomplete";
  return new NextRequest(url);
}

describe("GET /api/geocoding/city-autocomplete", () => {
  it("returns 401 when unauthenticated", async () => {
    getAuthContextMock.mockResolvedValue(null);

    const response = await GET(request("Austin"));

    expect(response.status).toBe(401);
    expect(autocompleteCitiesMock).not.toHaveBeenCalled();
  });

  it("reports unconfigured without hitting Google", async () => {
    getAuthContextMock.mockResolvedValue({ user: { id: "user-1" } });
    isGooglePlacesConfiguredMock.mockReturnValue(false);

    const response = await GET(request("Austin"));
    const body = await response.json();

    expect(body).toEqual({ configured: false, suggestions: [] });
    expect(autocompleteCitiesMock).not.toHaveBeenCalled();
  });

  it("returns empty suggestions for a too-short query", async () => {
    getAuthContextMock.mockResolvedValue({ user: { id: "user-1" } });
    isGooglePlacesConfiguredMock.mockReturnValue(true);

    const response = await GET(request("a"));
    const body = await response.json();

    expect(body).toEqual({ configured: true, suggestions: [] });
    expect(autocompleteCitiesMock).not.toHaveBeenCalled();
  });

  it("returns suggestions from Google Places", async () => {
    getAuthContextMock.mockResolvedValue({ user: { id: "user-1" } });
    isGooglePlacesConfiguredMock.mockReturnValue(true);
    autocompleteCitiesMock.mockResolvedValue([
      { placeId: "place-1", description: "Austin, TX, USA" },
    ]);

    const response = await GET(request("Austin"));
    const body = await response.json();

    expect(body).toEqual({
      configured: true,
      suggestions: [{ placeId: "place-1", description: "Austin, TX, USA" }],
    });
  });

  it("returns a 502 when the upstream lookup fails", async () => {
    getAuthContextMock.mockResolvedValue({ user: { id: "user-1" } });
    isGooglePlacesConfiguredMock.mockReturnValue(true);
    autocompleteCitiesMock.mockRejectedValue(new Error("boom"));

    const response = await GET(request("Austin"));

    expect(response.status).toBe(502);
  });
});
