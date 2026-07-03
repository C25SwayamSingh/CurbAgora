import { vi } from "vitest";

import type {
  OrganizationMember,
  Profile,
} from "@/lib/supabase/database.types";

export type MockUserConfig = {
  user?: { id: string; email?: string } | null;
  profile?: Partial<Profile> | null;
  memberships?: Partial<OrganizationMember>[];
  isPlatformAdmin?: boolean;
  /** Assurance level of the current session. */
  currentLevel?: "aal1" | "aal2";
  /** Highest level the user could reach (aal2 = has a verified factor). */
  nextLevel?: "aal1" | "aal2";
  /** When set, profile updates fail with this error (simulates RLS/grant failure). */
  profileUpdateError?: { code?: string; message: string } | null;
  /** When true, profile update succeeds but returns no row (missing profile). */
  profileUpdateMissing?: boolean;
};

function thenable(data: unknown) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    maybeSingle: async () => ({ data, error: null }),
    // Awaiting the builder resolves list queries.
    then: (resolve: (value: { data: unknown; error: null }) => void) =>
      resolve({ data, error: null }),
  };
  return builder;
}

/**
 * Minimal Supabase client mock covering the query shapes used by
 * src/lib/auth/guards.ts and the server actions under test.
 */
export function createMockSupabase(config: MockUserConfig) {
  const {
    user = null,
    profile = null,
    memberships = [],
    isPlatformAdmin = false,
    currentLevel = "aal1",
    nextLevel = "aal1",
    profileUpdateError = null,
    profileUpdateMissing = false,
  } = config;

  type MockError = { code?: string; message: string; status?: number } | null;

  const rpc = vi.fn(async (): Promise<{ data: unknown; error: MockError }> => ({
    data: null,
    error: null,
  }));

  const updatePayloads: unknown[] = [];
  const update = vi.fn((payload: unknown) => {
    updatePayloads.push(payload);
    const updateResult = profileUpdateMissing
      ? { data: null, error: null }
      : profileUpdateError
        ? { data: null, error: profileUpdateError }
        : {
            data: {
              id: user?.id,
              preferred_mode:
                (payload as { preferred_mode?: string }).preferred_mode ??
                profile?.preferred_mode,
            },
            error: null,
          };

    const builder = {
      eq: () => builder,
      select: () => builder,
      maybeSingle: async () => updateResult,
      then: (resolve: (value: { data: unknown; error: MockError }) => void) =>
        resolve(updateResult),
    };
    return builder;
  });

  const client = {
    auth: {
      getUser: vi.fn(async () =>
        user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { message: "no session" } },
      ),
      signUp: vi.fn(
        async (): Promise<{
          data: { user: unknown; session: unknown };
          error: MockError;
        }> => ({ data: { user, session: null }, error: null }),
      ),
      signInWithPassword: vi.fn(
        async (): Promise<{
          data: { user: unknown; session: unknown };
          error: MockError;
        }> => ({ data: { user, session: {} }, error: null }),
      ),
      resetPasswordForEmail: vi.fn(
        async (): Promise<{ data: unknown; error: MockError }> => ({
          data: {},
          error: null,
        }),
      ),
      updateUser: vi.fn(
        async (): Promise<{ data: { user: unknown }; error: MockError }> => ({
          data: { user },
          error: null,
        }),
      ),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({
          data: { currentLevel, nextLevel },
          error: null,
        })),
        listFactors: vi.fn(async () => ({
          data: { totp: [], all: [], phone: [] },
          error: null,
        })),
      },
      signOut: vi.fn(async () => ({ error: null })),
    },
    rpc,
    update,
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        const builder = {
          ...thenable(profile),
          update,
        };
        return builder;
      }
      if (table === "organization_members") {
        return thenable(memberships);
      }
      if (table === "platform_admins") {
        return thenable(isPlatformAdmin ? { user_id: user?.id } : null);
      }
      return thenable(null);
    }),
  };

  return client;
}
