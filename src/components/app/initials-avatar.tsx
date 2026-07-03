import { displayNameInitials } from "@/lib/app-config";
import { cn } from "@/lib/utils";

/** Placeholder avatar derived from display name until Supabase Storage uploads exist. */
export function InitialsAvatar({
  displayName,
  className,
}: {
  displayName: string;
  className?: string;
}) {
  const initials = displayNameInitials(displayName);

  return (
    <span
      className={cn(
        "inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary",
        className,
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
