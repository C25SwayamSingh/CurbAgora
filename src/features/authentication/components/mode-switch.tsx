"use client";

import { Store, UtensilsCrossed } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setPreferredModeAction } from "@/features/authentication/actions";
import type { PreferredMode } from "@/lib/supabase/database.types";

export function ModeSwitch({
  effectiveMode,
  hasMembership,
}: {
  effectiveMode: PreferredMode;
  hasMembership: boolean;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-border p-0.5"
      role="group"
      aria-label="Interface mode"
    >
      <form action={setPreferredModeAction}>
        <input type="hidden" name="preferredMode" value="customer" />
        <Button
          type="submit"
          variant={
            effectiveMode === "customer" || !hasMembership ? "default" : "ghost"
          }
          size="sm"
          className="h-8 gap-1.5 px-2.5"
        >
          <UtensilsCrossed className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Customer</span>
        </Button>
      </form>
      <form action={setPreferredModeAction}>
        <input type="hidden" name="preferredMode" value="vendor" />
        <Button
          type="submit"
          variant={
            effectiveMode === "vendor" && hasMembership ? "default" : "ghost"
          }
          size="sm"
          className="h-8 gap-1.5 px-2.5"
        >
          <Store className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">
            {hasMembership ? "Vendor" : "Become a vendor"}
          </span>
        </Button>
      </form>
    </div>
  );
}
