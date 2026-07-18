"use client";

import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Loader2, Store, UtensilsCrossed } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setPreferredModeAction } from "@/features/authentication/actions";
import type { PreferredMode } from "@/lib/supabase/database.types";

/**
 * Disables itself while its own form is submitting — must live inside the
 * `<form>` it belongs to, since useFormStatus reads the nearest ancestor
 * form's pending state. Without this, a fast double-tap could fire a second
 * mode switch before the first's redirect lands, leaving it unclear which
 * destination should win.
 */
function ModeButton({
  active,
  icon,
  label,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={active ? "default" : "ghost"}
      size="sm"
      disabled={pending}
      aria-busy={pending}
      className="h-8 gap-1.5 px-2.5"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        icon
      )}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

export function ModeSwitch({
  effectiveMode,
  hasMembership,
}: {
  effectiveMode: PreferredMode;
  hasMembership: boolean;
}) {
  // Threaded through as a hidden field so the action can return here on
  // failure instead of jumping to an unrelated page (see setPreferredModeAction).
  const pathname = usePathname();

  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-secondary-foreground/25 p-0.5"
      role="group"
      aria-label="Interface mode"
    >
      <form action={setPreferredModeAction}>
        <input type="hidden" name="preferredMode" value="customer" />
        <input type="hidden" name="currentPath" value={pathname} />
        <ModeButton
          active={effectiveMode === "customer" || !hasMembership}
          icon={<UtensilsCrossed className="size-3.5" aria-hidden="true" />}
          label="Customer"
        />
      </form>
      <form action={setPreferredModeAction}>
        <input type="hidden" name="preferredMode" value="vendor" />
        <input type="hidden" name="currentPath" value={pathname} />
        <ModeButton
          active={effectiveMode === "vendor" && hasMembership}
          icon={<Store className="size-3.5" aria-hidden="true" />}
          label={hasMembership ? "Vendor" : "Become a vendor"}
        />
      </form>
    </div>
  );
}
