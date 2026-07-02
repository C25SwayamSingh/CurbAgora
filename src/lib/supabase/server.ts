import "server-only";

import { cookies } from "next/headers";
import { createServerClient as createSsrServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

/**
 * Server-side Supabase client bound to the current request's auth cookies.
 * Uses the anon key — all data access is governed by RLS as the signed-in
 * user. Service-role access does not belong in this module.
 *
 * Create a fresh client per request (never module-level) so sessions are
 * not shared between users.
 */
export async function createServerClient(): Promise<SupabaseClient<Database>> {
  // Read cookies before env validation: cookie access marks the route as
  // dynamic, so build-time prerendering never requires Supabase credentials.
  const cookieStore = await cookies();
  const { url, anonKey } = getPublicSupabaseEnv();

  return createSsrServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component where cookies are read-only.
          // Safe to ignore: the proxy refreshes sessions on navigation.
        }
      },
    },
  });
}
