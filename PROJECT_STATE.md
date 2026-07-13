# Project State

**Last updated:** 2026-07-13 — Phase 2 authorization verification complete  
**Branch:** main @ `6783b93`  
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

**Production authorization defect — proven, not a test-harness issue.**

| #   | Assertion                                     | Expected              | Actual (pre-fix)                            |
| --- | --------------------------------------------- | --------------------- | ------------------------------------------- |
| 26  | `member cannot change their own role`         | `throws_ok` (`42501`) | Update succeeded (no exception)             |
| 27  | `final owner cannot remove themselves`        | `throws_ok` (`42501`) | Delete succeeded (no exception)             |
| 30  | `manager can view the org roster` (count = 2) | `is(..., 2)`          | Count was 1 after test 27 deleted owner row |

`protect_membership_update()` and `protect_membership_delete()` are SECURITY
DEFINER. They gated client protections with `current_user in ('anon',
'authenticated')`, but inside DEFINER functions `current_user` is `postgres`
(session role remains `authenticated`). Test 30 failed as a **downstream
cascade** from test 27.

**Fix:** `20260704000000_fix_membership_definer_triggers.sql` gates on
`current_setting('role', true)` instead. See `supabase/tests/README.md` and
`docs/SECURITY_MODEL.md`.

### Automated checks (2026-07-13)

| Check                                  | Result                        |
| -------------------------------------- | ----------------------------- |
| `npm run format`                       | pass                          |
| `npm run lint`                         | pass (1 pre-existing warning) |
| `npm run typecheck`                    | pass                          |
| `npm run test`                         | **116/116**                   |
| `npm run test:e2e`                     | **27/27**                     |
| `npm run build`                        | pass                          |
| `npm run db:reset` + `npm run db:test` | **51/51** pgTAP               |
| `npm run db:lint`                      | pass                          |

### Live auth flows (local Supabase + Mailpit, 2026-07-13)

Manual verification with `phase2-live-20260713@example.com` against
`npm run dev` + `npm run db:start`:

| #   | Flow                                    | Result                                            |
| --- | --------------------------------------- | ------------------------------------------------- |
| 1   | Create a new account                    | pass                                              |
| 2   | Open verification email in Mailpit      | pass                                              |
| 3   | Verify account                          | pass (PKCE confirm → onboarding)                  |
| 4   | Choose Discover vendors                 | pass                                              |
| 5   | Complete basic profile                  | pass                                              |
| 6   | Reach customer interface                | pass (`/customer`)                                |
| 7   | Customer mode without MFA               | pass                                              |
| 8   | Customer cannot access vendor dashboard | pass (`/vendor` → MFA enroll gate)                |
| 9   | Customer cannot access `/admin`         | pass (redirect to `/`)                            |
| 10  | Become a vendor (mode switch)           | pass (`Become a vendor` → `/mfa-enroll`)          |
| 11  | Return before vendor setup              | pass (customer session intact)                    |
| 12  | Vendor MFA gate                         | pass                                              |
| 13  | Full vendor org + dashboard             | pass (prior 2026-07-02 session; requires TOTP UI) |
| 14  | Mode switching vendor ↔ customer        | pass (prior session)                              |
| 15  | Sign out / sign in                      | pass                                              |
| 16  | Password reset (same-tab recovery)      | pass (POST `/auth/confirm` → `/reset-password`)   |
| 17  | Recovery token single-use               | pass (repeat POST → `/auth/error?flow=recovery`)  |

**Password recovery:** email → `/auth/recovery` interstitial → POST
`/auth/confirm`. Use the forgot-password **Continue in this tab** button in
local dev (Mailpit forces `target="_blank"` on email links).

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
