import { vi } from "vitest";

import type {
  OrganizationMember,
  Profile,
  VendorUnit,
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
  /** Factors returned by auth.mfa.listFactors(); drives enroll/cancel/verify scenarios. */
  mfaFactors?: {
    id: string;
    factor_type: "totp";
    status: "verified" | "unverified";
  }[];
  /** Force auth.mfa.enroll() to fail with this error. */
  mfaEnrollError?: { code?: string; message: string } | null;
  /** Force auth.mfa.verify() to fail with this error. */
  mfaVerifyError?: { code?: string; message: string } | null;
  /** Force auth.mfa.unenroll() to fail with this error. */
  mfaUnenrollError?: { code?: string; message: string } | null;
  /** Row returned by a single-row vendor_units select (.maybeSingle()); null = none exists. */
  vendorUnit?: Partial<VendorUnit> | null;
  /** Rows returned by a list-shaped vendor_units select (no .maybeSingle()). */
  vendorUnits?: Partial<VendorUnit>[];
  /** Force vendor_units insert to fail with this error. */
  vendorUnitInsertError?: { code?: string; message: string } | null;
  /** Force vendor_units update to fail with this error. */
  vendorUnitUpdateError?: { code?: string; message: string } | null;
  /** When true, vendor_units update succeeds but matches no row. */
  vendorUnitUpdateMissing?: boolean;
  /** Force vendor_location_sessions insert to fail with this error. */
  locationSessionInsertError?: { code?: string; message: string } | null;
  /** Force vendor_location_sessions update to fail with this error. */
  locationSessionUpdateError?: { code?: string; message: string } | null;
  /** When true, vendor_location_sessions update succeeds but matches no row. */
  locationSessionUpdateMissing?: boolean;
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
    mfaFactors = [],
    mfaEnrollError = null,
    mfaVerifyError = null,
    mfaUnenrollError = null,
    vendorUnit = null,
    vendorUnits = [],
    vendorUnitInsertError = null,
    vendorUnitUpdateError = null,
    vendorUnitUpdateMissing = false,
    locationSessionInsertError = null,
    locationSessionUpdateError = null,
    locationSessionUpdateMissing = false,
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

  const vendorUnitInsertPayloads: unknown[] = [];
  const vendorUnitInsert = vi.fn((payload: unknown) => {
    vendorUnitInsertPayloads.push(payload);
    const result = { error: vendorUnitInsertError };
    return {
      then: (resolve: (value: typeof result) => void) => resolve(result),
    };
  });

  const vendorUnitUpdatePayloads: unknown[] = [];
  const vendorUnitUpdate = vi.fn((payload: unknown) => {
    vendorUnitUpdatePayloads.push(payload);
    const updateResult = vendorUnitUpdateError
      ? { data: null, error: vendorUnitUpdateError }
      : vendorUnitUpdateMissing
        ? { data: null, error: null }
        : { data: { id: vendorUnit?.id ?? "unit-1" }, error: null };

    const builder = {
      eq: () => builder,
      select: () => builder,
      maybeSingle: async () => updateResult,
      then: (resolve: (value: typeof updateResult) => void) =>
        resolve(updateResult),
    };
    return builder;
  });

  const locationSessionInsertPayloads: unknown[] = [];
  const locationSessionInsert = vi.fn((payload: unknown) => {
    locationSessionInsertPayloads.push(payload);
    const result = { error: locationSessionInsertError };
    return {
      then: (resolve: (value: typeof result) => void) => resolve(result),
    };
  });

  const locationSessionUpdatePayloads: unknown[] = [];
  const locationSessionUpdate = vi.fn((payload: unknown) => {
    locationSessionUpdatePayloads.push(payload);
    const updateResult = locationSessionUpdateError
      ? { data: null, error: locationSessionUpdateError }
      : locationSessionUpdateMissing
        ? { data: null, error: null }
        : { data: { id: "session-1" }, error: null };

    const builder = {
      eq: () => builder,
      select: () => builder,
      maybeSingle: async () => updateResult,
      then: (resolve: (value: typeof updateResult) => void) =>
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
          data: {
            totp: mfaFactors.filter((f) => f.status === "verified"),
            all: mfaFactors,
            phone: [],
          },
          error: null,
        })),
        enroll: vi.fn(async (): Promise<{ data: unknown; error: MockError }> =>
          mfaEnrollError
            ? { data: null, error: mfaEnrollError }
            : {
                data: {
                  id: "factor-new",
                  totp: {
                    qr_code: "data:image/svg+xml;base64,mock",
                    secret: "MOCKSECRET",
                    uri: "otpauth://totp/CurbAgora:mock?secret=MOCKSECRET&issuer=CurbAgora",
                  },
                },
                error: null,
              },
        ),
        challenge: vi.fn(
          async (): Promise<{ data: unknown; error: MockError }> => ({
            data: { id: "challenge-1" },
            error: null,
          }),
        ),
        verify: vi.fn(async (): Promise<{ data: unknown; error: MockError }> =>
          mfaVerifyError
            ? { data: null, error: mfaVerifyError }
            : { data: {}, error: null },
        ),
        unenroll: vi.fn(
          async (): Promise<{ data: unknown; error: MockError }> =>
            mfaUnenrollError
              ? { data: null, error: mfaUnenrollError }
              : { data: {}, error: null },
        ),
      },
      signOut: vi.fn(async () => ({ error: null })),
    },
    rpc,
    update,
    vendorUnitInsert,
    vendorUnitUpdate,
    locationSessionInsert,
    locationSessionUpdate,
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
      if (table === "vendor_units" || table === "vendor_unit_previews") {
        // .maybeSingle() resolves the single-row config; a plain awaited
        // list query (no .maybeSingle()) resolves the array config — a
        // real query only ever uses one or the other, matching how the
        // dashboard (list) vs. edit-page/idempotency-check (single)
        // queries are actually shaped.
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          maybeSingle: async () => ({ data: vendorUnit, error: null }),
          then: (resolve: (value: { data: unknown; error: null }) => void) =>
            resolve({ data: vendorUnits, error: null }),
          insert: vendorUnitInsert,
          update: vendorUnitUpdate,
        };
        return builder;
      }
      if (table === "vendor_location_sessions") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve: (value: { data: unknown; error: null }) => void) =>
            resolve({ data: [], error: null }),
          insert: locationSessionInsert,
          update: locationSessionUpdate,
        };
        return builder;
      }
      return thenable(null);
    }),
  };

  return client;
}
