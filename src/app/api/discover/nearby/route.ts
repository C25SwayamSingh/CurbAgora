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
  // Which location states to include. Absent means the default view: real
  // vendors, no hotspots. The database applies the same defaults, so a
  // hand-crafted request cannot surface hotspots by omitting a parameter.
  live: z.coerce.boolean().optional(),
  scheduled: z.coerce.boolean().optional(),
  recurring: z.coerce.boolean().optional(),
  hotspots: z.coerce.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const flag = (name: string) =>
    params.has(name) ? params.get(name) === "true" : undefined;

  const parsed = querySchema.safeParse({
    lat: params.get("lat"),
    lng: params.get("lng"),
    radius: params.get("radius"),
    live: flag("live"),
    scheduled: flag("scheduled"),
    recurring: flag("recurring"),
    hotspots: flag("hotspots"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("nearby_vendor_locations", {
    p_latitude: parsed.data.lat,
    p_longitude: parsed.data.lng,
    p_radius_miles: parsed.data.radius,
    p_include_live: parsed.data.live ?? true,
    p_include_scheduled: parsed.data.scheduled ?? true,
    p_include_recurring: parsed.data.recurring ?? true,
    // Off unless asked for: the default view is real vendors, not empty
    // parking spots.
    p_include_hotspots: parsed.data.hotspots ?? false,
  });

  if (error) {
    console.error("nearby location lookup failed", { code: error.code });
    return NextResponse.json({ error: "lookup_failed" }, { status: 502 });
  }

  return NextResponse.json({ results: data ?? [] });
}
