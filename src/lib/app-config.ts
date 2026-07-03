/**
 * Central application metadata — do not hardcode branding in components.
 */
export const APP_CONFIG = {
  name: "CurbAgora",
  shortDescription:
    "Discover mobile food vendors and help carts, trucks, and pop-ups reach customers.",
  supportEmail: "support@example.com",
  tagline: "Find mobile food vendors near you.",
} as const;

/** Page title helper: "Sign in — CurbAgora" */
export function pageTitle(page: string): string {
  return `${page} — ${APP_CONFIG.name}`;
}

/** Derive one or two initials from a display name for avatar placeholders. */
export function displayNameInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}
