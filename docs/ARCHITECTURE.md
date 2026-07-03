# Architecture

## Overview

CurbAgora (food-vendor-platform) is a production-ready platform for mobile food vendors — food carts, food trucks, stands, and pop-up vendors — and the customers who discover them. Application branding is centralized in `src/lib/app-config.ts`.

Phase 1 established the application foundation. Phase 2 adds authentication, user profiles, organizations (tenants), memberships/roles, MFA foundations, and database-level tenant isolation.

## Tech Stack

| Layer           | Technology                                     |
| --------------- | ---------------------------------------------- |
| Framework       | Next.js (App Router, TypeScript)               |
| Styling         | Tailwind CSS v4, shadcn/ui                     |
| Database / Auth | Supabase (Postgres + RLS, Supabase Auth, TOTP) |
| Sessions        | @supabase/ssr cookie-based sessions            |
| Validation      | Zod (server-side)                              |
| Unit tests      | Vitest, React Testing Library                  |
| DB policy tests | pgTAP (`supabase test db`)                     |
| E2E tests       | Playwright                                     |
| CI              | GitHub Actions                                 |

## Project Structure

```
supabase/
├── config.toml           # Local Supabase stack (auth + TOTP MFA enabled)
├── migrations/           # Versioned SQL migrations (schema, RLS, functions)
└── tests/                # pgTAP policy tests (adversarial RLS + AAL coverage)
src/
├── proxy.ts              # Session refresh + coarse route guards (Next.js 16
│                         # "proxy" convention; replaces middleware.ts)
├── app/                  # Next.js routes and layouts
│   ├── (auth)/           # sign-up, sign-in, forgot/reset password,
│   │                     # verify-email, mfa-challenge, mfa-enroll
│   ├── auth/             # confirm + callback route handlers, error page
│   ├── onboarding/       # account-type choice, customer/vendor onboarding
│   │   └── vendor/       # profile → MFA enroll/verify → org creation
│   ├── account/          # profile + security (MFA, sessions)
│   ├── customer/         # customer dashboard (guarded)
│   ├── vendor/           # vendor dashboard (guarded, org-scoped, AAL2
│   │                     # mandatory for owner/manager roles)
│   └── admin/            # platform admin (guarded, MFA required)
├── components/
│   ├── ui/               # shadcn/ui primitives
│   ├── app/              # Signed-in app shell, onboarding progress
│   └── marketing/        # Public marketing components
├── features/             # Domain modules (one folder per bounded context)
│   ├── authentication/   # Schemas, server actions, form components
│   ├── organizations/    # Org creation (atomic owner assignment, AAL2)
│   └── …                 # Other domains (placeholders until their phase)
└── lib/
    ├── auth/             # guards.ts, routes.ts, redirect.ts
    └── supabase/         # env.ts, client.ts, server.ts, database.types.ts
```

## Authentication & Authorization Layers

Authorization is enforced in three layers; each lower layer assumes the ones
above it can be bypassed:

1. **Proxy** (`src/proxy.ts`, Next.js 16's `middleware.ts` replacement) —
   refreshes the Supabase session cookie on every request and applies coarse
   signed-in/signed-out route rules from `src/lib/auth/routes.ts`.
   Convenience only, never trusted, never the source of an authorization
   decision.
2. **Server guards** (`src/lib/auth/guards.ts`) — every protected page and
   server action re-verifies the user (`auth.getUser()`, server-validated),
   profile state, org memberships, platform-admin status, and MFA assurance
   level (aal) against the database. For organization owners/managers and
   platform admins, MFA is mandatory: `enforceMfaVerified()` independently
   redirects to `/mfa-enroll` (no factor yet) or `/mfa-challenge` (factor
   enrolled, session not yet aal2) — every sensitive server action calls
   this again immediately before writing, never relying on a page-level
   redirect alone.
3. **Row Level Security** — every table is default-deny; policies and
   triggers in `supabase/migrations/` are the final authority. Even a bug in
   the app layer cannot read or write another tenant's rows, and even a
   `SECURITY DEFINER` function that bypasses RLS (like
   `create_organization_with_owner()`) independently re-checks the JWT's
   `aal` claim. See `docs/SECURITY_MODEL.md` for the full MFA/AAL model.

## Supabase Integration

- `env.ts` — Public env accessors. Placeholders are allowed only in
  development/test; production/staging fail fast at startup if
  unconfigured (and require https URLs).
- `client.ts` — Browser client (`@supabase/ssr` `createBrowserClient`),
  anon key only.
- `server.ts` — Per-request server client bound to the request's cookies.
  All queries run as the signed-in user under RLS.
- `database.types.ts` — Typed schema (kept in sync with migrations;
  regenerate with `supabase gen types typescript --local`).
- Service-role usage is not present in the app. Privileged operations
  (e.g. granting platform admins) happen via migrations or operator
  tooling outside the Next.js bundle.

## Explicitly Out of Scope (Phase 2)

- Payment processing, SMS, Mapbox/maps
- Menus, live locations, loyalty, reviews, promotions, billing, ambassadors
- Organization member invitation UI (DB policies exist; UI in a later phase)
- Admin moderation tooling (secure `/admin` shell only)

## Environment Configuration

Separate example files are provided for local, staging, and production:

- `.env.local.example` (includes local Supabase CLI values)
- `.env.staging.example`
- `.env.production.example`

See `docs/SECURITY_MODEL.md` for credential handling rules.
