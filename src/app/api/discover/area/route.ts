import { NextResponse, type NextRequest } from "next/server";

import {
  autocompleteCities,
  isGooglePlacesConfigured,
  resolvePlaceLocation,
} from "@/lib/geocoding/google-places";

/**
 * Manual search-area fallback for customer discovery, usable WITHOUT an
 * account (discovery is a public page — customers who denied device
 * location still need it). Two modes:
 *
 *   ?q=austin        → city suggestions ({ placeId, description })
 *   ?placeId=ChIJ... → that place's coordinates ({ latitude, longitude })
 *
 * The Google key stays server-side; responses expose only suggestion text
 * and coordinates. Minimum query length plus single-purpose modes keep
 * this from being a general-purpose proxy to Google's API.
 */
export async function GET(request: NextRequest) {
  if (!isGooglePlacesConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const placeId = request.nextUrl.searchParams.get("placeId")?.trim();
  if (placeId) {
    try {
      const location = await resolvePlaceLocation(placeId);
      if (!location) {
        return NextResponse.json(
          { configured: true, error: "not_found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ configured: true, location });
    } catch {
      return NextResponse.json(
        { configured: true, error: "lookup_failed" },
        { status: 502 },
      );
    }
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
