/**
 * Adversarial tests for vendor location sessions: any active member
 * (owner/manager/staff) can start/update/end, a stranger cannot, the
 * organization is always server-derived from membership, and database
 * error codes map to safe, specific messages.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockSupabase, type MockUserConfig } from "@/test/mock-supabase";

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
);
const createServerClientMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: createServerClientMock,
}));

import {
  endLocationSessionAction,
  startLocationSessionAction,
  updateLocationSessionAction,
} from "@/features/vendors/location-actions";
import { idleState } from "@/features/authentication/action-state";

function useSupabase(config: MockUserConfig) {
  const client = createMockSupabase(config);
  createServerClientMock.mockResolvedValue(client);
  return client;
}

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

const user = { id: "user-1", email: "vendor@example.com" };
const vendorProfile = {
  id: "user-1",
  account_type: "vendor" as const,
  onboarding_status: "complete" as const,
};

function membership(role: "owner" | "manager" | "staff") {
  return {
    id: "m-1",
    organization_id: "org-1",
    user_id: "user-1",
    role,
    status: "active" as const,
  };
}

const validStartForm = {
  unitId: "unit-1",
  latitude: "30.2672",
  longitude: "-97.7431",
  publicLabel: "Corner of 5th & Main",
};

const validUpdateForm = {
  sessionId: "session-1",
  latitude: "30.27",
  longitude: "-97.74",
  publicLabel: "Moved a block over",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startLocationSessionAction", () => {
  it("requires authentication", async () => {
    useSupabase({ user: null });
    await expect(
      startLocationSessionAction(idleState, form(validStartForm)),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("blocks a stranger with no membership", async () => {
    useSupabase({ user, profile: vendorProfile, memberships: [] });
    await expect(
      startLocationSessionAction(idleState, form(validStartForm)),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor");
  });

  it.each(["owner", "manager", "staff"] as const)(
    "allows %s to start a session",
    async (role) => {
      const client = useSupabase({
        user,
        profile: vendorProfile,
        memberships: [membership(role)],
      });
      const state = await startLocationSessionAction(
        idleState,
        form(validStartForm),
      );
      expect(state.status).toBe("success");
      expect(client.locationSessionInsert).toHaveBeenCalledTimes(1);
    },
  );

  it("derives organization_id/created_by server-side (mass-assignment protection)", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("staff")],
    });
    await startLocationSessionAction(
      idleState,
      form({
        ...validStartForm,
        organizationId: "someone-elses-org",
        createdBy: "someone-else",
      }),
    );
    const payload = client.locationSessionInsert.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.organization_id).toBe("org-1");
    expect(payload.created_by).toBe("user-1");
    expect(payload.vendor_unit_id).toBe("unit-1");
  });

  it("validates required fields server-side", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    const state = await startLocationSessionAction(
      idleState,
      form({ ...validStartForm, publicLabel: "" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.publicLabel).toBeDefined();
    expect(client.locationSessionInsert).not.toHaveBeenCalled();
  });

  it("rejects out-of-range coordinates", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    const state = await startLocationSessionAction(
      idleState,
      form({ ...validStartForm, latitude: "200" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.latitude).toBeDefined();
  });

  it("surfaces an already-open session as a friendly error", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      locationSessionInsertError: { code: "23505", message: "duplicate key" },
    });
    const state = await startLocationSessionAction(
      idleState,
      form(validStartForm),
    );
    expect(state.status).toBe("error");
    expect(state.message).toMatch(/already has an active session/i);
    expect(client.locationSessionInsert).toHaveBeenCalledTimes(1);
  });

  it("surfaces a unit from another organization as a field error, not a raw RLS error", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      locationSessionInsertError: {
        code: "42501",
        message: "new row violates row-level security policy",
      },
    });
    const state = await startLocationSessionAction(
      idleState,
      form(validStartForm),
    );
    expect(state.status).toBe("error");
    expect(state.message).not.toMatch(/row-level security/i);
    expect(state.fieldErrors?.unitId).toBeDefined();
  });

  it("returns a safe generic error for unexpected database failures", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      locationSessionInsertError: { code: "XXYYZ", message: "disk on fire" },
    });
    const state = await startLocationSessionAction(
      idleState,
      form(validStartForm),
    );
    expect(state.status).toBe("error");
    expect(state.message).not.toMatch(/disk on fire/i);
  });
});

describe("updateLocationSessionAction", () => {
  it("requires authentication", async () => {
    useSupabase({ user: null });
    await expect(
      updateLocationSessionAction(idleState, form(validUpdateForm)),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });

  it.each(["owner", "manager", "staff"] as const)(
    "allows %s to update a session",
    async (role) => {
      const client = useSupabase({
        user,
        profile: vendorProfile,
        memberships: [membership(role)],
      });
      const state = await updateLocationSessionAction(
        idleState,
        form(validUpdateForm),
      );
      expect(state.status).toBe("success");
      expect(client.locationSessionUpdate).toHaveBeenCalledTimes(1);
    },
  );

  it("bumps last_confirmed_at on every update", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    await updateLocationSessionAction(idleState, form(validUpdateForm));
    const payload = client.locationSessionUpdate.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.last_confirmed_at).toBeDefined();
  });

  it("never lets the client move a session to a different organization", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    await updateLocationSessionAction(idleState, form(validUpdateForm));
    const payload = client.locationSessionUpdate.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.organization_id).toBeUndefined();
  });

  it("returns a not-found error when the session doesn't match the caller's organization", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      locationSessionUpdateMissing: true,
    });
    const state = await updateLocationSessionAction(
      idleState,
      form(validUpdateForm),
    );
    expect(state.status).toBe("error");
  });

  it("returns a safe generic error for unexpected database failures", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      locationSessionUpdateError: {
        code: "42501",
        message: "permission denied",
      },
    });
    const state = await updateLocationSessionAction(
      idleState,
      form(validUpdateForm),
    );
    expect(state.status).toBe("error");
    expect(state.message).not.toMatch(/permission denied/i);
  });
});

describe("endLocationSessionAction", () => {
  it("requires authentication", async () => {
    useSupabase({ user: null });
    await expect(
      endLocationSessionAction(idleState, form({ sessionId: "session-1" })),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });

  it.each(["owner", "manager", "staff"] as const)(
    "allows %s to end a session",
    async (role) => {
      const client = useSupabase({
        user,
        profile: vendorProfile,
        memberships: [membership(role)],
      });
      const state = await endLocationSessionAction(
        idleState,
        form({ sessionId: "session-1" }),
      );
      expect(state.status).toBe("success");
      const payload = client.locationSessionUpdate.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(payload.ended_at).toBeDefined();
    },
  );

  it("returns a not-found error when the session doesn't match the caller's organization", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      locationSessionUpdateMissing: true,
    });
    const state = await endLocationSessionAction(
      idleState,
      form({ sessionId: "session-1" }),
    );
    expect(state.status).toBe("error");
  });

  it("requires a sessionId", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    const state = await endLocationSessionAction(idleState, form({}));
    expect(state.status).toBe("error");
    expect(client.locationSessionUpdate).not.toHaveBeenCalled();
  });
});
