import Link from "next/link";
import { MapPin, Store, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LandingPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Truck className="size-6 text-primary" aria-hidden="true" />
            <span className="text-lg font-semibold tracking-tight">
              StreetEats
            </span>
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <nav className="hidden gap-6 text-sm text-muted-foreground sm:flex">
              <a href="#customers" className="hover:text-foreground">
                For Customers
              </a>
              <a href="#vendors" className="hover:text-foreground">
                For Vendors
              </a>
            </nav>
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">Sign up</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mb-3 text-sm font-medium uppercase tracking-wider text-primary">
              Mobile food vendor platform
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              Find great street food near you. Grow your mobile business.
            </h1>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              A platform for food carts, trucks, stands, and pop-up vendors to
              reach hungry customers — and for customers to discover what is
              open right now.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/discover">
                  <MapPin aria-hidden="true" />
                  Find Vendors
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="w-full sm:w-auto"
              >
                <Link href="/vendors/list">
                  <Store aria-hidden="true" />
                  List Your Business
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <section
          id="customers"
          className="border-y border-border/60 bg-muted/40 py-12 sm:py-16"
        >
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              For customers
            </h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Discover mobile food vendors near you — carts, trucks, stands, and
              pop-ups — and see who is serving today.
            </p>
            <ul className="mt-6 grid gap-4 sm:grid-cols-3">
              <li className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <MapPin className="mb-3 size-5 text-brand-fresh" />
                <h3 className="font-medium">Discover nearby vendors</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Browse mobile food vendors and see live location updates when
                  available.
                </p>
              </li>
              <li className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <Store className="mb-3 size-5 text-brand-fresh" />
                <h3 className="font-medium">Explore menus</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  View menus before you visit so you know what each vendor is
                  serving.
                </p>
              </li>
              <li className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <Truck className="mb-3 size-5 text-brand-fresh" />
                <h3 className="font-medium">Support local street food</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Find independent operators and pop-up vendors in your area.
                </p>
              </li>
            </ul>
          </div>
        </section>

        <section id="vendors" className="py-12 sm:py-16">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              For vendors
            </h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              List your food cart, truck, stand, or pop-up and help customers
              find you when you are open.
            </p>
            <ul className="mt-6 grid gap-4 sm:grid-cols-3">
              <li className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h3 className="font-medium">Claim your business profile</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create a vendor profile for your mobile food operation.
                </p>
              </li>
              <li className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h3 className="font-medium">Share live locations</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Let customers know where you are serving today.
                </p>
              </li>
              <li className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h3 className="font-medium">Manage menus and reviews</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Keep your menu up to date and build trust with customer
                  feedback.
                </p>
              </li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-6">
        <p className="text-center text-sm text-muted-foreground">
          StreetEats — Phase 1 foundation
        </p>
      </footer>
    </div>
  );
}
