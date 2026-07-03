import Link from "next/link";

import { APP_CONFIG } from "@/lib/app-config";
import { SignOutButton } from "@/features/authentication/components/sign-out-button";

/** Shared header/footer chrome for signed-in areas. */
export function AppShell({
  children,
  nav,
  modeSwitch,
}: {
  children: React.ReactNode;
  nav?: { href: string; label: string }[];
  modeSwitch?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            {APP_CONFIG.name}
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4">
            {nav ? (
              <nav className="flex gap-3 text-sm text-muted-foreground sm:gap-5">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            ) : null}
            {modeSwitch}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
