# Project State

**Last updated:** Phase 2 — pgTAP membership trigger fix + live auth verification  
**Branch:** main  
**Product spec:** `docs/PRODUCT_SPEC.md` not yet added

## Current Status

Phase 2 is complete, verified, and hardened. The app has full authentication
(Supabase Auth via @supabase/ssr cookie sessions), user profiles,
customer/vendor dual-mode onboarding on one account, interface mode switching,
vendor organizations with role-based
memberships, a platform-admin foundation, TOTP MFA, database-level tenant
isolation (RLS default-deny on every table), and **mandatory MFA (aal2) for
organization owners/managers and platform administrators** — enforced
independently in the server guards, the sensitive server actions, and the
database.

## What Works

- Sign-up with email verification, sign-in/out, password reset (all
  testable locally against Mailpit at http://localhost:54324 once the local
  Supabase stack is running)
- Onboarding: **“What would you like to do first?”** (Discover vendors vs Set up
  vendor business); sets `preferred_mode` (UI only, not permanent); customer
  profile completion; vendor sequence profile → mandatory MFA → atomic org
  creation → dashboard; **Become a vendor** later on the same account
- Header **mode switch** (Customer / Vendor / Become a vendor); vendor routes
  still require active `organization_members`
- Simplified **Account** (initials avatar, read-only email, preferred mode, org
  summary) and **Security** (password change, MFA, sessions, sign out)
- Branding centralized as **CurbAgora** in `src/lib/app-config.ts`
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
  `organization_members`/`platform_admins` foundation, MFA enforcement
  hardening, authenticated table-privilege grants, preferred-mode account
  model, membership DEFINER trigger fix) + a **51/51** pgTAP suite
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

## Verification Status (Phase 2 close-out)

### pgTAP root cause (tests 26, 27, 30)

**Production authorization defect — not a test harness issue.**

`protect_membership_update()` and `protect_membership_delete()` are SECURITY
DEFINER. They gated client protections with `current_user in ('anon',
'authenticated')`, but inside DEFINER functions `current_user` is `postgres`,
so self role changes and final-owner deletion were not blocked for API clients.

**Fix:** `20260704000000_fix_membership_definer_triggers.sql` gates on
`current_setting('role', true)` instead. See `supabase/tests/README.md` and
`docs/SECURITY_MODEL.md`.

### Automated checks (2026-07-02)

| Check                                  | Result          |
| -------------------------------------- | --------------- |
| `npm run format`                       | pass            |
| `npm run lint`                         | pass            |
| `npm run typecheck`                    | pass            |
| `npm run test`                         | **103/103**     |
| `npm run test:e2e`                     | **26/26**       |
| `npm run build`                        | pass            |
| `npm run db:reset` + `npm run db:test` | **51/51** pgTAP |
| `npm run db:lint`                      | pass            |

### Live auth flows (local Supabase + Mailpit)

Manual verification with `liveflow.tester@example.com` and
`nomember.tester@example.com` against `npm run dev` + `npm run db:start`:

| #   | Flow                                      | Result                                             |
| --- | ----------------------------------------- | -------------------------------------------------- |
| 1   | Sign up + verify email                    | pass (verify page; Mailpit link uses PKCE)         |
| 2   | Choose Discover vendors                   | pass                                               |
| 3   | Reach customer mode                       | pass (`/customer`)                                 |
| 4   | Become a vendor (mode switch)             | pass (redirects to vendor onboarding)              |
| 5   | Return safely before vendor setup         | pass                                               |
| 6   | Complete vendor profile                   | pass                                               |
| 7   | Enroll and verify MFA                     | pass (after stale-factor cleanup + QR `<img>` fix) |
| 8   | Create organization                       | pass (`Live Flow Taco Cart`)                       |
| 9   | Reach vendor mode                         | pass (`/vendor`)                                   |
| 10  | Switch vendor → customer                  | pass                                               |
| 11  | Switch customer → vendor                  | pass                                               |
| 12  | Non-member cannot access vendor dashboard | pass (`/vendor` → vendor onboarding/MFA gate)      |
| 13  | Normal user cannot access `/admin`        | pass (redirect to `/`)                             |
| 14  | Sign out / sign in with MFA challenge     | pass (`/mfa-challenge` → `/vendor`)                |
| 15  | Password reset via Mailpit                | pass (after redirect fix to `/auth/callback`)      |

**App fixes discovered during live testing:**

- Vendor MFA page: removed deprecated `account_type` gate
- MFA enrollment: native `<img>` for Supabase QR data URLs
- MFA re-enroll: clear **unverified** factors via `listFactors().all` (Supabase
  only lists verified factors in `.totp`)
- Password reset email: `redirectTo` must use `/auth/callback` for PKCE recovery
  links (not `/auth/confirm`)

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
npm run db:test      # pgTAP RLS + MFA/AAL policy tests (51 assertions)
npm run db:lint      # Static analysis of the schema
npm run db:types     # Regenerate src/lib/supabase/database.types.ts
```

## Next Steps (Phase 3)

1. Organization member invitation and role management UI (policies +
   `requireVendorSensitiveAction()` guard ready)
2. Public vendor profile pages
3. Admin user/org management tooling (service-role backed, outside client app)

## Assumptions

- Product name: **CurbAgora** (`src/lib/app-config.ts`)
- One account supports customer and vendor interfaces; vendor authorization is membership-based
- Email delivery uses Supabase's built-in auth emails (local: Mailpit via CLI)
- Platform admins are granted manually via migration/service role by design
