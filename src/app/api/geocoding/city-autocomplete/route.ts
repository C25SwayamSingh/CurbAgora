import { NextResponse, type NextRequest } from "next/server";

import { getAuthContext } from "@/lib/auth/guards";
import {
  autocompleteCities,
  isGooglePlacesConfigured,
} from "@/lib/geocoding/google-places";

/**
 * Server-side proxy for Google Places city autocomplete: keeps
 * GOOGLE_PLACES_API_KEY out of the browser bundle. Requires an
 * authenticated session (matches the rest of the vendor-setup flow) so
 * this can't be used as an open, unauthenticated proxy to Google's API.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isGooglePlacesConfigured()) {
    return NextResponse.json({ configured: false, suggestions: [] });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ configured: true, suggestions: [] });
  }

  try {
    const suggestions = await autocompleteCities(query);
    return NextResponse.json({ configured: true, suggestions });
  } catch {
    return NextResponse.json(
      { configured: true, suggestions: [], error: "lookup_failed" },
      { status: 502 },
    );
  }
}
