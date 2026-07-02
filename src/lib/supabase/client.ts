"use client";

import { createBrowserClient as createSsrBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

let browserClient: SupabaseClient<Database> | undefined;

/**
 * Browser Supabase client (anon key only, cookie-based sessions via
 * @supabase/ssr). Never import service-role credentials here.
 */
export function createBrowserClient(): SupabaseClient<Database> {
  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = getPublicSupabaseEnv();
  browserClient = createSsrBrowserClient<Database>(url, anonKey);
  return browserClient;
}
