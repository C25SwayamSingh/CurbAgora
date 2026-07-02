import { afterEach, describe, expect, it, vi } from "vitest";

import { getPublicSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getPublicSupabaseEnv", () => {
  it("returns placeholder values when env vars are missing in test/dev", () => {
    const env = getPublicSupabaseEnv();

    expect(env.url).toBe("https://placeholder.supabase.co");
    expect(env.anonKey).toBe("placeholder-anon-key");
  });

  it("reports unconfigured state without env vars", () => {
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("fails fast when unconfigured outside development", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => getPublicSupabaseEnv()).toThrow(/Supabase is not configured/);
  });

  it("returns real values when configured in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://real.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "real-key");

    expect(getPublicSupabaseEnv()).toEqual({
      url: "https://real.supabase.co",
      anonKey: "real-key",
    });
  });

  it("rejects non-https URLs in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://insecure.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "real-key");

    expect(() => getPublicSupabaseEnv()).toThrow(/https/);
  });
});
