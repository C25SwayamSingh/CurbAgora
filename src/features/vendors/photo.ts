/**
 * Shared (client-safe) constants and helpers for the optional vendor unit
 * business photo. The authoritative limits live in three layers that must
 * agree: here (app validation, client + server), the storage bucket's own
 * file_size_limit/allowed_mime_types, and the storage RLS path policies —
 * see supabase/migrations/20260711000000_vendor_unit_photos.sql.
 */

export const VENDOR_PHOTO_BUCKET = "vendor-photos";
export const VENDOR_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** For the file input's accept attribute. */
export const VENDOR_PHOTO_ACCEPT = Object.keys(MIME_TO_EXTENSION).join(",");

export const VENDOR_PHOTO_TYPE_ERROR = "Use a JPEG, PNG, or WebP image.";
export const VENDOR_PHOTO_SIZE_ERROR = "Keep the photo under 5MB.";

/** Returns a user-facing error message, or null when the file is acceptable. */
export function validateVendorPhotoFile(file: {
  type: string;
  size: number;
}): string | null {
  if (!(file.type in MIME_TO_EXTENSION)) {
    return VENDOR_PHOTO_TYPE_ERROR;
  }
  if (file.size > VENDOR_PHOTO_MAX_BYTES) {
    return VENDOR_PHOTO_SIZE_ERROR;
  }
  return null;
}

/**
 * Object path for a new photo. The {organization_id}/{vendor_unit_id}/
 * prefix is what the storage RLS policies authorize against; the random
 * filename makes every replacement a brand-new URL (no stale caches).
 */
export function vendorPhotoObjectPath(
  organizationId: string,
  vendorUnitId: string,
  mimeType: string,
): string {
  const extension = MIME_TO_EXTENSION[mimeType] ?? "jpg";
  return `${organizationId}/${vendorUnitId}/photo-${crypto.randomUUID()}.${extension}`;
}

/**
 * Public URL for a stored photo path, or null when there is no photo (or
 * Supabase isn't configured, e.g. some test environments). Safe in client
 * bundles: NEXT_PUBLIC_SUPABASE_URL is public by definition.
 */
export function vendorPhotoPublicUrl(path: string | null): string | null {
  if (!path) {
    return null;
  }
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl}/storage/v1/object/public/${VENDOR_PHOTO_BUCKET}/${path}`;
}
