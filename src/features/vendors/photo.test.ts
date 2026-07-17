import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VENDOR_PHOTO_MAX_BYTES,
  VENDOR_PHOTO_SIZE_ERROR,
  VENDOR_PHOTO_TYPE_ERROR,
  validateVendorPhotoFile,
  vendorPhotoObjectPath,
  vendorPhotoPublicUrl,
} from "@/features/vendors/photo";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateVendorPhotoFile", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])(
    "accepts %s within the size limit",
    (type) => {
      expect(validateVendorPhotoFile({ type, size: 1024 })).toBeNull();
    },
  );

  it.each(["image/gif", "image/svg+xml", "application/pdf", "text/html"])(
    "rejects %s",
    (type) => {
      expect(validateVendorPhotoFile({ type, size: 1024 })).toBe(
        VENDOR_PHOTO_TYPE_ERROR,
      );
    },
  );

  it("rejects a file over the size limit", () => {
    expect(
      validateVendorPhotoFile({
        type: "image/jpeg",
        size: VENDOR_PHOTO_MAX_BYTES + 1,
      }),
    ).toBe(VENDOR_PHOTO_SIZE_ERROR);
  });

  it("accepts a file exactly at the size limit", () => {
    expect(
      validateVendorPhotoFile({
        type: "image/jpeg",
        size: VENDOR_PHOTO_MAX_BYTES,
      }),
    ).toBeNull();
  });
});

describe("vendorPhotoObjectPath", () => {
  it("prefixes org/unit (what storage RLS authorizes on) and matches the MIME extension", () => {
    const path = vendorPhotoObjectPath("org-1", "unit-2", "image/webp");
    expect(path).toMatch(/^org-1\/unit-2\/photo-[0-9a-f-]+\.webp$/);
  });

  it("generates a unique filename per call (replacements never collide)", () => {
    const a = vendorPhotoObjectPath("org-1", "unit-2", "image/png");
    const b = vendorPhotoObjectPath("org-1", "unit-2", "image/png");
    expect(a).not.toBe(b);
  });
});

describe("vendorPhotoPublicUrl", () => {
  it("returns null for a null path", () => {
    expect(vendorPhotoPublicUrl(null)).toBeNull();
  });

  it("builds the public storage URL from the Supabase base URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(vendorPhotoPublicUrl("org-1/unit-2/photo-x.jpg")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/vendor-photos/org-1/unit-2/photo-x.jpg",
    );
  });

  it("returns null when Supabase isn't configured instead of a broken URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(vendorPhotoPublicUrl("org-1/unit-2/photo-x.jpg")).toBeNull();
  });
});
