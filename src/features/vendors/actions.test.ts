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
const shouldVerifyCityMock = vi.hoisted(() => vi.fn(() => false));
const verifyCityPlaceMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: createServerClientMock,
}));
vi.mock("@/lib/geocoding/google-places", () => ({
  shouldVerifyCity: shouldVerifyCityMock,
  verifyCityPlace: verifyCityPlaceMock,
}));

import {
  createVendorUnitAction,
  updateVendorUnitAction,
} from "@/features/vendors/actions";
import { VENDOR_PHOTO_MAX_BYTES } from "@/features/vendors/photo";
import { idleState } from "@/features/authentication/action-state";

function useSupabase(config: MockUserConfig) {
  const client = createMockSupabase(config);
  createServerClientMock.mockResolvedValue(client);
  return client;
}

function form(entries: Record<string, string | string[] | File>) {
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

function photoFile(type = "image/jpeg", bytes = 1024, name = "photo.jpg") {
  return new File([new Uint8Array(bytes)], name, { type });
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
  state: "TX",
  contactPhone: "",
  contactEmail: "",
  paymentMethods: ["cash", "credit_card"],
  operatingStatus: "open",
};

beforeEach(() => {
  vi.clearAllMocks();
  shouldVerifyCityMock.mockReturnValue(false);
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

  it("skips city verification when not configured (e.g. local dev)", async () => {
    shouldVerifyCityMock.mockReturnValue(false);
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    await expect(
      createVendorUnitAction(idleState, form(validForm)),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(verifyCityPlaceMock).not.toHaveBeenCalled();
    expect(client.vendorUnitInsert).toHaveBeenCalledTimes(1);
  });

  it("requires a selected placeId when city verification is enabled", async () => {
    shouldVerifyCityMock.mockReturnValue(true);
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    const state = await createVendorUnitAction(idleState, form(validForm));
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.city).toBeDefined();
    expect(client.vendorUnitInsert).not.toHaveBeenCalled();
  });

  it("rejects a city whose verified state does not match the submitted state", async () => {
    shouldVerifyCityMock.mockReturnValue(true);
    verifyCityPlaceMock.mockResolvedValue({ city: "Austin", state: "TX" });
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    const state = await createVendorUnitAction(
      idleState,
      form({ ...validForm, placeId: "place-1", state: "CA" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.city).toBeDefined();
    expect(client.vendorUnitInsert).not.toHaveBeenCalled();
  });

  it("creates the unit once the placeId verifies against the submitted city/state", async () => {
    shouldVerifyCityMock.mockReturnValue(true);
    verifyCityPlaceMock.mockResolvedValue({ city: "Austin", state: "TX" });
    const client = useSupabase({
      user,
      profile: vendorProfile,
      memberships: [membership("owner")],
    });
    await expect(
      createVendorUnitAction(
        idleState,
        form({ ...validForm, placeId: "place-1" }),
      ),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(verifyCityPlaceMock).toHaveBeenCalledWith("place-1");
    expect(client.vendorUnitInsert).toHaveBeenCalledTimes(1);
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

describe("vendor unit photos", () => {
  const owner = () => ({
    user,
    profile: vendorProfile,
    memberships: [membership("owner")],
  });
  const formWithUnitId = { ...validForm, unitId: "unit-1" };

  it("create: rejects a non-image file as a field error, before any insert", async () => {
    const client = useSupabase(owner());
    const state = await createVendorUnitAction(
      idleState,
      form({ ...validForm, photo: photoFile("application/pdf") }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.photo).toBeDefined();
    expect(client.vendorUnitInsert).not.toHaveBeenCalled();
    expect(client.storageUpload).not.toHaveBeenCalled();
  });

  it("create: rejects an oversized photo as a field error", async () => {
    const client = useSupabase(owner());
    const state = await createVendorUnitAction(
      idleState,
      form({
        ...validForm,
        photo: photoFile("image/jpeg", VENDOR_PHOTO_MAX_BYTES + 1),
      }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.photo).toBeDefined();
    expect(client.vendorUnitInsert).not.toHaveBeenCalled();
  });

  it("create: uploads a valid photo under the org/unit path and points the unit at it", async () => {
    const client = useSupabase(owner());
    await expect(
      createVendorUnitAction(
        idleState,
        form({ ...validForm, photo: photoFile("image/png") }),
      ),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.storageUpload).toHaveBeenCalledTimes(1);
    const uploadPath = client.storageUpload.mock.calls[0]![0] as string;
    expect(uploadPath).toMatch(/^org-1\/unit-new\/photo-[0-9a-f-]+\.png$/);
    const pathUpdate = client.vendorUnitUpdate.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(pathUpdate.primary_image_path).toBe(uploadPath);
  });

  it("create: a zero-byte (untouched) file input is treated as no photo", async () => {
    const client = useSupabase(owner());
    await expect(
      createVendorUnitAction(
        idleState,
        form({
          ...validForm,
          photo: new File([], "", { type: "application/octet-stream" }),
        }),
      ),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.storageUpload).not.toHaveBeenCalled();
  });

  it("create: a failed upload still creates the unit (logged, not fatal)", async () => {
    const client = useSupabase({
      ...owner(),
      storageUploadError: { message: "bucket on fire" },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await expect(
      createVendorUnitAction(
        idleState,
        form({ ...validForm, photo: photoFile() }),
      ),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.vendorUnitInsert).toHaveBeenCalledTimes(1);
    expect(client.vendorUnitUpdate).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("update: replaces the photo and removes the previous object", async () => {
    const client = useSupabase({
      ...owner(),
      vendorUnitPhotoPath: "org-1/unit-1/photo-old.jpg",
    });
    await expect(
      updateVendorUnitAction(
        idleState,
        form({ ...formWithUnitId, photo: photoFile("image/webp") }),
      ),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.storageUpload).toHaveBeenCalledTimes(1);
    const uploadPath = client.storageUpload.mock.calls[0]![0] as string;
    expect(uploadPath).toMatch(/^org-1\/unit-1\/photo-[0-9a-f-]+\.webp$/);
    expect(client.storageRemove).toHaveBeenCalledWith([
      "org-1/unit-1/photo-old.jpg",
    ]);
  });

  it("update: a failed upload keeps the old photo and reports the error", async () => {
    const client = useSupabase({
      ...owner(),
      vendorUnitPhotoPath: "org-1/unit-1/photo-old.jpg",
      storageUploadError: { message: "bucket on fire" },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const state = await updateVendorUnitAction(
      idleState,
      form({ ...formWithUnitId, photo: photoFile() }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.photo).toBeDefined();
    expect(state.message).not.toMatch(/bucket on fire/i);
    expect(client.storageRemove).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("update: removePhoto clears the path and deletes the object", async () => {
    const client = useSupabase({
      ...owner(),
      vendorUnitPhotoPath: "org-1/unit-1/photo-old.jpg",
    });
    await expect(
      updateVendorUnitAction(
        idleState,
        form({ ...formWithUnitId, removePhoto: "true" }),
      ),
    ).rejects.toThrow("REDIRECT:/vendor");
    const clearPayload = client.vendorUnitUpdate.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((payload) => "primary_image_path" in payload);
    expect(clearPayload?.primary_image_path).toBeNull();
    expect(client.storageRemove).toHaveBeenCalledWith([
      "org-1/unit-1/photo-old.jpg",
    ]);
  });

  it("update: removePhoto with no existing photo touches nothing in storage", async () => {
    const client = useSupabase(owner());
    await expect(
      updateVendorUnitAction(
        idleState,
        form({ ...formWithUnitId, removePhoto: "true" }),
      ),
    ).rejects.toThrow("REDIRECT:/vendor");
    expect(client.storageRemove).not.toHaveBeenCalled();
    expect(client.storageUpload).not.toHaveBeenCalled();
  });
});
