/**
 * Public Supabase environment variables safe for browser and server bundles.
 * Service-role keys must never be referenced from client-accessible modules.
 *
 * Outside development/test, missing configuration fails fast instead of
 * silently falling back to placeholders (P0: no half-configured production).
 */

export type PublicSupabaseEnv = {
  url: string;
  anonKey: string;
};

const PLACEHOLDER_ENV: PublicSupabaseEnv = {
  url: "https://placeholder.supabase.co",
  anonKey: "placeholder-anon-key",
};

function isDevelopmentLike(): boolean {
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}

export function getPublicSupabaseEnv(): PublicSupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (isDevelopmentLike()) {
      return PLACEHOLDER_ENV;
    }
    throw new Error(
      "Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY are required outside development. " +
        "Refusing to start with placeholder credentials.",
    );
  }

  if (!isDevelopmentLike()) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        throw new Error("must use https");
      }
    } catch {
      throw new Error(
        `NEXT_PUBLIC_SUPABASE_URL is not a valid https URL: ${url}`,
      );
    }
  }

  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
