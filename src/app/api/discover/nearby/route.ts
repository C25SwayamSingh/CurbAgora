import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createServerClient } from "@/lib/supabase/server";

/**
 * Public nearby-vendor discovery. The customer's coordinates are used for
 * this one query and never stored. Inputs are validated here AND inside
 * the nearby_live_vendors database function itself — this route is just
 * the polite first line; the function is the enforcement.
 */
const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  // The UI offers 1/3/5/10; anything positive up to the DB function's own
  // 25-mile ceiling is accepted so the two layers can't drift apart.
  radius: z.coerce.number().positive().max(25),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat"),
    lng: request.nextUrl.searchParams.get("lng"),
    radius: request.nextUrl.searchParams.get("radius"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("nearby_live_vendors", {
    p_latitude: parsed.data.lat,
    p_longitude: parsed.data.lng,
    p_radius_miles: parsed.data.radius,
  });

  if (error) {
    console.error("nearby vendor lookup failed", { code: error.code });
    return NextResponse.json({ error: "lookup_failed" }, { status: 502 });
  }

  return NextResponse.json({ vendors: data ?? [] });
}
