import Link from "next/link";
import { Truck } from "lucide-react";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border/60">
        <div className="mx-auto flex w-full max-w-5xl items-center px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Truck className="size-6 text-primary" aria-hidden="true" />
            <span className="text-lg font-semibold tracking-tight">
              StreetEats
            </span>
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 sm:py-14">
        {children}
      </main>
    </div>
  );
}
