import Link from "next/link";

import { APP_CONFIG } from "@/lib/app-config";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="bg-secondary text-secondary-foreground">
        <div className="mx-auto flex w-full max-w-5xl items-center px-4 py-4 sm:px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            {APP_CONFIG.name}
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 sm:py-14">
        {children}
      </main>
    </div>
  );
}
