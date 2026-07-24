import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const createServerClientMock = vi.hoisted(() =>
  vi.fn(async () => ({ rpc: rpcMock })),
);

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: createServerClientMock,
}));

import { GET } from "./route";

function request(params: Record<string, string>) {
  const search = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost/api/discover/nearby?${search}`);
}

describe("GET /api/discover/nearby", () => {
  it("rejects a missing or malformed query", async () => {
    const response = await GET(request({}));
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    { lat: "91", lng: "-74", radius: "5" },
    { lat: "40", lng: "-181", radius: "5" },
    { lat: "40", lng: "-74", radius: "0" },
    { lat: "40", lng: "-74", radius: "26" },
    { lat: "abc", lng: "-74", radius: "5" },
  ])("rejects out-of-range input %o", async (params) => {
    const response = await GET(request(params));
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes validated coordinates and default filters to the database function", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const response = await GET(
      request({ lat: "40.44", lng: "-74.46", radius: "5" }),
    );

    expect(response.status).toBe(200);
    // Default view: real vendors across all three confirmed states, hotspots
    // OFF — an empty parking zone must never surface unless explicitly asked.
    expect(rpcMock).toHaveBeenCalledWith("nearby_vendor_locations", {
      p_latitude: 40.44,
      p_longitude: -74.46,
      p_radius_miles: 5,
      p_include_live: true,
      p_include_scheduled: true,
      p_include_recurring: true,
      p_include_hotspots: false,
    });
    expect(await response.json()).toEqual({ results: [] });
  });

  it("passes explicit filter flags through to the database function", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await GET(
      request({
        lat: "40",
        lng: "-74",
        radius: "3",
        live: "false",
        scheduled: "false",
        recurring: "false",
        hotspots: "true",
      }),
    );

    expect(rpcMock).toHaveBeenCalledWith("nearby_vendor_locations", {
      p_latitude: 40,
      p_longitude: -74,
      p_radius_miles: 3,
      p_include_live: false,
      p_include_scheduled: false,
      p_include_recurring: false,
      p_include_hotspots: true,
    });
  });

  it("returns the results from the database function", async () => {
    const result = {
      result_id: "LIVE:u1",
      state: "LIVE",
      name: "Cart",
      distance_miles: 0.4,
    };
    rpcMock.mockResolvedValue({ data: [result], error: null });

    const response = await GET(request({ lat: "40", lng: "-74", radius: "3" }));
    const body = await response.json();

    expect(body.results).toEqual([result]);
  });

  it("returns a safe 502 when the database call fails, without leaking details", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "internal detail" },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await GET(request({ lat: "40", lng: "-74", radius: "3" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(JSON.stringify(body)).not.toMatch(/internal detail/);
    consoleError.mockRestore();
  });
});
