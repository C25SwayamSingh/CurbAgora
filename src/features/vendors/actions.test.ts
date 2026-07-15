/**
 * Adversarial tests for vendor unit creation/update: owner/manager-only
 * access, multiple units per organization, per-unit id-scoped updates, and
 * that the organization is always server-derived from membership — never
 * taken from client input.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockSupabase, type MockUserConfig } from "@/test/mock-supabase";

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
);
const createServerClientMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: createServerClientMock,
}));

import {
  createVendorUnitAction,
  updateVendorUnitAction,
} from "@/features/vendors/actions";
import { idleState } from "@/features/authentication/action-state";

function useSupabase(config: MockUserConfig) {
  const client = createMockSupabase(config);
  createServerClientMock.mockResolvedValue(client);
  return client;
}

function form(entries: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const v of value) data.append(key, v);
    } else {
      data.set(key, value);
    }
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

const validForm = {
  name: "Maria's Taco Cart",
  slug: "taco-cart",
  unitType: "food_truck",
  description: "Tacos and more.",
  cuisineCategories: ["mexican", "american"],
  city: "Austin",
  contactPhone: "",
  contactEmail: "",
  paymentMethods: ["cash", "credit_card"],
  operatingStatus: "open",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createVendorUnitAction", () => {
  it("requires authentication", async () => {
    useSupabase({ user: null });
    await expect(
      createVendorUnitAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("blocks staff (owner/manager only)", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("staff")],
    });
    await expect(
      createVendorUnitAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.vendorUnitInsert).not.toHaveBeenCalled();
  });

  it("validates required fields server-side", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    const state = await createVendorUnitAction(
      idleState,
      form({ ...validForm, name: "" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.name).toBeDefined();
    expect(client.vendorUnitInsert).not.toHaveBeenCalled();
  });

  it("rejects a malformed slug", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    const state = await createVendorUnitAction(
      idleState,
      form({ ...validForm, slug: "Not A Slug!" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.slug).toBeDefined();
  });

  it("rejects an invalid vendor type", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    const state = await createVendorUnitAction(
      idleState,
      form({ ...validForm, unitType: "food_spaceship" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.unitType).toBeDefined();
  });

  it("creates the unit with a server-derived organization_id, for owners", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    await expect(
      createVendorUnitAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/vendor");

    expect(client.vendorUnitInsert).toHaveBeenCalledTimes(1);
    const payload = client.vendorUnitInsert.mock.calls[0]![0];
    expect(payload).toMatchObject({
      organization_id: "org-1",
      created_by: "user-1",
      name: "Maria's Taco Cart",
      slug: "taco-cart",
      unit_type: "food_truck",
      cuisine_categories: ["mexican", "american"],
      city: "Austin",
      payment_methods: ["cash", "credit_card"],
      operating_status: "open",
    });
  });

  it("creates the unit for managers too", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("manager")],
    });
    await expect(
      createVendorUnitAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.vendorUnitInsert).toHaveBeenCalledTimes(1);
  });

  it("allows creating a second unit for the same organization (no one-per-org limit)", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      // An existing unit is present, but that no longer blocks creation.
      vendorUnits: [{ id: "unit-1", organization_id: "org-1" }],
    });
    await expect(
      createVendorUnitAction(
        idleState,
        form({ ...validForm, slug: "second-cart" }),
      ),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.vendorUnitInsert).toHaveBeenCalledTimes(1);
  });

  it("ignores client-supplied organization_id/created_by/id (mass-assignment protection)", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    await expect(
      createVendorUnitAction(
        idleState,
        form({
          ...validForm,
          organization_id: "someone-elses-org",
          created_by: "someone-else",
          id: "attacker-chosen-id",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/vendor");

    const payload = client.vendorUnitInsert.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.organization_id).toBe("org-1");
    expect(payload.created_by).toBe("user-1");
    expect(payload.id).toBeUndefined();
  });

  it("surfaces a duplicate slug within the same organization as a field error", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      vendorUnitInsertError: { code: "23505", message: "duplicate key" },
    });
    const state = await createVendorUnitAction(idleState, form(validForm));
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.slug).toBeDefined();
    expect(client.vendorUnitInsert).toHaveBeenCalledTimes(1);
  });

  it("returns a safe generic error for unexpected database failures", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      vendorUnitInsertError: { code: "42501", message: "permission denied" },
    });
    const state = await createVendorUnitAction(idleState, form(validForm));
    expect(state.status).toBe("error");
    expect(state.message).not.toMatch(/permission denied/i);
  });
});

describe("updateVendorUnitAction", () => {
  const formWithUnitId = { ...validForm, unitId: "unit-1" };

  it("requires authentication", async () => {
    useSupabase({ user: null });
    await expect(
      updateVendorUnitAction(idleState, form(formWithUnitId)),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("blocks staff (owner/manager only)", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("staff")],
    });
    await expect(
      updateVendorUnitAction(idleState, form(formWithUnitId)),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.vendorUnitUpdate).not.toHaveBeenCalled();
  });

  it("requires a unitId", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    const state = await updateVendorUnitAction(idleState, form(validForm));
    expect(state.status).toBe("error");
    expect(client.vendorUnitUpdate).not.toHaveBeenCalled();
  });

  it("validates required fields server-side", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    const state = await updateVendorUnitAction(
      idleState,
      form({ ...formWithUnitId, city: "" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.city).toBeDefined();
    expect(client.vendorUnitUpdate).not.toHaveBeenCalled();
  });

  it("updates only the caller's own organization's unit", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("manager")],
      vendorUnit: { id: "unit-1" },
    });
    await expect(
      updateVendorUnitAction(idleState, form(formWithUnitId)),
    ).rejects.toThrow("REDIRECT:/vendor");

    expect(client.vendorUnitUpdate).toHaveBeenCalledTimes(1);
    const payload = client.vendorUnitUpdate.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    // Never in the update payload: the client cannot move a unit to a
    // different organization or spoof its id via this action — targeting
    // is done entirely through .eq("id", ...).eq("organization_id", ...).
    expect(payload.organization_id).toBeUndefined();
    expect(payload.id).toBeUndefined();
  });

  it("sends staff/non-members to onboarding, never another org's data", async () => {
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [],
    });
    await expect(
      updateVendorUnitAction(idleState, form(formWithUnitId)),
    ).rejects.toThrow("REDIRECT:/onboarding/vendor");
    expect(client.vendorUnitUpdate).not.toHaveBeenCalled();
  });

  it("returns a not-found error when the id doesn't match the caller's organization", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      vendorUnitUpdateMissing: true,
    });
    const state = await updateVendorUnitAction(idleState, form(formWithUnitId));
    expect(state.status).toBe("error");
  });

  it("surfaces a duplicate slug within the same organization as a field error", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      vendorUnitUpdateError: { code: "23505", message: "duplicate key" },
    });
    const state = await updateVendorUnitAction(idleState, form(formWithUnitId));
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.slug).toBeDefined();
  });

  it("returns a safe generic error for unexpected database failures", async () => {
    useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
      vendorUnitUpdateError: { code: "42501", message: "permission denied" },
    });
    const state = await updateVendorUnitAction(idleState, form(formWithUnitId));
    expect(state.status).toBe("error");
    expect(state.message).not.toMatch(/permission denied/i);
  });
});
