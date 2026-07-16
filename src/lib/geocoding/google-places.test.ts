import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  autocompleteCities,
  getGooglePlacesApiKey,
  isGooglePlacesConfigured,
  shouldVerifyCity,
  verifyCityPlace,
} from "@/lib/geocoding/google-places";

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("isGooglePlacesConfigured / getGooglePlacesApiKey", () => {
  it("reports unconfigured without the env var", () => {
    expect(isGooglePlacesConfigured()).toBe(false);
  });

  it("throws when the key is requested but missing", () => {
    expect(() => getGooglePlacesApiKey()).toThrow(/not configured/);
  });

  it("returns the key when configured", () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    expect(getGooglePlacesApiKey()).toBe("test-key");
  });
});

describe("shouldVerifyCity", () => {
  it("skips verification in development/test when unconfigured", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(shouldVerifyCity()).toBe(false);
  });

  it("requires verification outside development when unconfigured", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldVerifyCity()).toBe(true);
  });

  it("requires verification when NODE_ENV is unset (fail safe by default)", () => {
    vi.stubEnv("NODE_ENV", "");
    expect(shouldVerifyCity()).toBe(true);
  });

  it("requires verification whenever configured, regardless of environment", () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    vi.stubEnv("NODE_ENV", "test");
    expect(shouldVerifyCity()).toBe(true);
  });

  it("security regression: a misconfigured production deploy can never silently skip verification", () => {
    // No GOOGLE_PLACES_API_KEY, NODE_ENV=production — the exact shape of
    // "someone forgot to set the key in prod". shouldVerifyCity() must
    // say verification is required, and the function that would actually
    // perform it must throw rather than return a fabricated result — the
    // combination that forces callers (verifyCityOrError in actions.ts)
    // to fail closed with a field error instead of saving unverified data.
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldVerifyCity()).toBe(true);
    expect(() => getGooglePlacesApiKey()).toThrow(/not configured/);
  });
});

describe("autocompleteCities", () => {
  it("maps Google's response shape to city suggestions", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            placePrediction: {
              placeId: "place-1",
              text: { text: "Austin, TX, USA" },
            },
          },
          { placePrediction: { placeId: "", text: { text: "" } } },
        ],
      }),
    });

    const results = await autocompleteCities("Austin");

    expect(results).toEqual([
      { placeId: "place-1", description: "Austin, TX, USA" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://places.googleapis.com/v1/places:autocomplete",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Goog-Api-Key": "test-key" }),
      }),
    );
  });

  it("throws when the API responds with an error status", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    await expect(autocompleteCities("Austin")).rejects.toThrow(/403/);
  });
});

describe("verifyCityPlace", () => {
  it("extracts city and state from address components", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        addressComponents: [
          { longText: "Austin", types: ["locality"] },
          {
            longText: "Texas",
            shortText: "TX",
            types: ["administrative_area_level_1"],
          },
        ],
      }),
    });

    const result = await verifyCityPlace("place-1");

    expect(result).toEqual({ city: "Austin", state: "TX" });
  });

  it("returns null when the place has no locality component", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        addressComponents: [
          {
            longText: "Texas",
            shortText: "TX",
            types: ["administrative_area_level_1"],
          },
        ],
      }),
    });

    expect(await verifyCityPlace("place-1")).toBeNull();
  });

  it("returns null when the API responds with an error status", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    expect(await verifyCityPlace("bad-place")).toBeNull();
  });
});
