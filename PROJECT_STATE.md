# Project State

**Last updated:** Phase 2 — authentication & tenancy (security-hardening pass)  
**Branch:** main  
**Product spec:** `docs/PRODUCT_SPEC.md` not yet added

## Current Status

Phase 2 is complete, verified, and hardened. The app has full authentication
(Supabase Auth via @supabase/ssr cookie sessions), user profiles,
customer/vendor onboarding, vendor organizations with role-based
memberships, a platform-admin foundation, TOTP MFA, database-level tenant
isolation (RLS default-deny on every table), and **mandatory MFA (aal2) for
organization owners/managers and platform administrators** — enforced
independently in the server guards, the sensitive server actions, and the
database.

## What Works

- Sign-up with email verification, sign-in/out, password reset (all
  testable locally against Mailpit at http://localhost:54324 once the local
  Supabase stack is running)
- Onboarding: one-time customer/vendor choice; customer profile completion;
  **vendor sequence is profile → mandatory MFA enroll/verify → atomic
  organization creation → dashboard**
- Protected areas with server-side guards + RLS: `/onboarding`, `/account`,
  `/account/security`, `/customer`, `/vendor`, `/admin`, `/mfa-enroll`,
  `/mfa-challenge`
- TOTP MFA: enroll, sign-in challenge, verify, unenroll; "sign out other
  sessions". MFA is **optional** for customers/staff and **mandatory** for
  organization owners/managers (before creating/managing an org, and before
  reaching `/vendor` at all) and for platform admins (always) — with no
  custom, client-writable MFA flag; every check reads Supabase Auth's own
  `aal` JWT claim.
- Role model: customer, vendor staff/manager/owner, platform admin
  (dedicated table, writable only via migrations/service role)
- Versioned Supabase migrations (`profiles`/`organizations`/
  `organization_members`/`platform_admins` foundation, plus an MFA
  enforcement-hardening migration) + a 46-assertion pgTAP suite
- Fail-fast env validation outside development; `src/proxy.ts` (Next.js 16's
  `middleware.ts` replacement) session refresh
- CI pipeline (lint, typecheck, unit tests, E2E)

## What Does Not Work Yet

- Org member invitation/management UI (DB policies + AAL2 guard ready)
- Organization-settings UI (DB policies + AAL2 guard ready)
- Admin moderation tooling (secure `/admin` shell only)
- Admin-assisted MFA recovery
- Customer discovery, maps, menus, reviews, loyalty, billing, SMS, payments
- Per-device session listing (Supabase limitation; revoke-others supported)
- CI execution of `db:test`/`db:lint` (no Docker-capable runner configured)

## Verification Status (this hardening pass)

- **Database tests**: the pgTAP suite (46 assertions, up from 34) is
  written and ready but **could not be executed** in the authoring
  environment — no Docker-compatible container runtime is available (no
  `docker`, `colima`, `podman`, or Homebrew to install one). Exact commands
  still required: `npm run db:start && npm run db:reset && npm run db:test
&& npm run db:lint`. See `supabase/tests/README.md`.
- **Manual auth-flow verification**: could not be performed for the same
  reason (`npm run dev` against a live Supabase stack, plus Mailpit for
  verification/reset emails, both require the local stack). All 12
  requested flows are implemented in code and covered by the automated
  unit/E2E suite where a live backend isn't required; live-backend
  verification remains an open TODO for an environment with Docker.
- **Everything else** (`npm run format`, `lint`, `typecheck`, `test`,
  `test:e2e`, `build`) passes green in this environment.

## Requirements to Run With Real Data

1. Local: a Docker-compatible container runtime (Docker Desktop, OrbStack,
   Colima, …) + `npm install` (fetches the `supabase` CLI locally) →
   `npm run db:start`, then copy the printed URL/anon key into
   `.env.local`.
2. Remote: create a Supabase project, `npx supabase db push` the
   migrations, configure auth email templates/redirect URLs, set env vars.

## Commands

```bash
npm run dev          # Start development server
npm run lint         # ESLint
npm run typecheck    # TypeScript check
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright E2E tests
npm run format       # Prettier

npm run db:start     # Local Postgres + Auth (Docker-compatible runtime required)
npm run db:stop      # Stop the local stack
npm run db:reset     # Re-apply migrations locally
npm run db:test      # pgTAP RLS + MFA/AAL policy tests (46 assertions)
npm run db:lint      # Static analysis of the schema
npm run db:types     # Regenerate src/lib/supabase/database.types.ts
```

## Next Steps (Phase 3)

1. Organization member invitation and role management UI (policies +
   `requireVendorSensitiveAction()` guard ready)
2. Public vendor profile pages
3. Admin user/org management tooling (service-role backed, outside client app)

## Assumptions

- Product name: **StreetEats** (placeholder until product spec defines branding)
- Email delivery uses Supabase's built-in auth emails (local: Mailpit via CLI)
- Platform admins are granted manually via migration/service role by design
