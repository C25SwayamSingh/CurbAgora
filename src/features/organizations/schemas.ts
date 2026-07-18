import { z } from "zod";

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46})[a-z0-9]$/;

export const createOrganizationSchema = z.object({
  legalName: z
    .string()
    .trim()
    .min(2, "Legal name must be at least 2 characters")
    .max(200, "Legal name is too long"),
  displayName: z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(120, "Display name is too long"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      SLUG_PATTERN,
      "Use 2-48 lowercase letters, numbers, and hyphens (no leading/trailing hyphen)",
    ),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Same shape as creation — editing business details reuses every rule. */
export const updateOrganizationSchema = createOrganizationSchema;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/** Derive a URL-safe slug suggestion from a display name. */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}
