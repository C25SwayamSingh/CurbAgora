import "server-only";

/**
 * Server-only Google Places integration for verifying a vendor's city.
 * The API key must never be imported into client components or exposed
 * via `NEXT_PUBLIC_`. Mirrors the dev-placeholder-fallback philosophy in
 * `src/lib/supabase/env.ts`: missing configuration is tolerated in
 * development/test (city verification is simply skipped), but fails fast
 * outside those environments so production can never silently run
 * unverified.
 */

const PLACES_AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete";
const PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places";

function isDevelopmentLike(): boolean {
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}

export function isGooglePlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export function getGooglePlacesApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY is not configured. City verification is " +
        "required outside development — refusing to accept unverified " +
        "city input in this environment.",
    );
  }
  return key;
}

/**
 * True if city verification should run at all in this environment.
 *
 * Security property: skipping verification when GOOGLE_PLACES_API_KEY is
 * missing is permitted ONLY when NODE_ENV is "development" or "test". In
 * any other environment (staging, production, or NODE_ENV unset/unknown)
 * this returns true even without a key — callers (see verifyCityOrError
 * in actions.ts) must then require a placeId and fail closed with a field
 * error, since verifyCityPlace()/getGooglePlacesApiKey() will throw rather
 * than silently succeed. A vendor unit can never be saved with an
 * unverified city outside local development/test.
 */
export function shouldVerifyCity(): boolean {
  if (isGooglePlacesConfigured()) {
    return true;
  }
  return isDevelopmentLike() ? false : true;
}

export type CitySuggestion = { placeId: string; description: string };

/** Server-side proxy for Google Places Autocomplete, restricted to cities. */
export async function autocompleteCities(
  query: string,
): Promise<CitySuggestion[]> {
  const apiKey = getGooglePlacesApiKey();
  const response = await fetch(PLACES_AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
    },
    body: JSON.stringify({
      input: query,
      includedPrimaryTypes: ["locality"],
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Places autocomplete failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    suggestions?: {
      placePrediction?: { placeId?: string; text?: { text?: string } };
    }[];
  };

  return (data.suggestions ?? [])
    .map((s) => ({
      placeId: s.placePrediction?.placeId ?? "",
      description: s.placePrediction?.text?.text ?? "",
    }))
    .filter((s) => s.placeId && s.description);
}

export type PlaceLocation = { latitude: number; longitude: number };

/**
 * Resolves a Place ID to its coordinates — used as the search center for
 * customer nearby discovery when the customer types an area instead of
 * sharing device location. Returns null when the place has no location.
 */
export async function resolvePlaceLocation(
  placeId: string,
): Promise<PlaceLocation | null> {
  const apiKey = getGooglePlacesApiKey();
  const response = await fetch(
    `${PLACES_DETAILS_URL}/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "location",
      },
    },
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    location?: { latitude?: number; longitude?: number };
  };

  if (
    typeof data.location?.latitude !== "number" ||
    typeof data.location?.longitude !== "number"
  ) {
    return null;
  }

  return {
    latitude: data.location.latitude,
    longitude: data.location.longitude,
  };
}

export type VerifiedCity = { city: string; state: string };

/**
 * Resolves a Place ID (as selected from autocomplete) to a verified
 * city + 2-letter state code. Returns null if the place isn't a real
 * city-level result (e.g. a street address or a non-US place with no
 * locality/administrative_area_level_1 components).
 */
export async function verifyCityPlace(
  placeId: string,
): Promise<VerifiedCity | null> {
  const apiKey = getGooglePlacesApiKey();
  const response = await fetch(
    `${PLACES_DETAILS_URL}/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "addressComponents",
      },
    },
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    addressComponents?: {
      longText?: string;
      shortText?: string;
      types?: string[];
    }[];
  };

  const components = data.addressComponents ?? [];
  const cityComponent = components.find((c) => c.types?.includes("locality"));
  const stateComponent = components.find((c) =>
    c.types?.includes("administrative_area_level_1"),
  );

  if (!cityComponent?.longText || !stateComponent?.shortText) {
    return null;
  }

  return { city: cityComponent.longText, state: stateComponent.shortText };
}
