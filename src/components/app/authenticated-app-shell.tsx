import { AppShell } from "@/components/app/app-shell";
import {
  effectivePreferredMode,
  hasVendorMembership,
  resolveDashboardPath,
} from "@/lib/auth/mode";
import { getAuthContext } from "@/lib/auth/guards";
import { ModeSwitch } from "@/features/authentication/components/mode-switch";

/** Signed-in chrome with dashboard nav and interface mode switch. */
export async function AuthenticatedAppShell({
  children,
  extraNav,
}: {
  children: React.ReactNode;
  extraNav?: { href: string; label: string }[];
}) {
  const ctx = await getAuthContext();
  const dashboardHref = ctx ? resolveDashboardPath(ctx) : "/customer";
  const effectiveMode = ctx ? effectivePreferredMode(ctx) : "customer";
  const membership = ctx ? hasVendorMembership(ctx) : false;

  const nav = [
    { href: dashboardHref, label: "Dashboard" },
    ...(extraNav ?? []),
  ];

  return (
    <AppShell
      nav={nav}
      modeSwitch={
        ctx ? (
          <ModeSwitch
            effectiveMode={effectiveMode}
            hasMembership={membership}
          />
        ) : null
      }
    >
      {children}
    </AppShell>
  );
}
