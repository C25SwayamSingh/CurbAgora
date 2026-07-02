# Database policy tests (pgTAP)

Adversarial tests for the Row Level Security policies, triggers, SECURITY
DEFINER functions, and mandatory MFA (AAL2) enforcement created in:

- `supabase/migrations/20260701000000_auth_tenancy_foundation.sql`
- `supabase/migrations/20260702000000_mfa_enforcement_hardening.sql`

## What is covered (46 assertions)

- Default deny: anonymous role reads nothing from any table
- **Mandatory MFA for organization creation**: an AAL1 (password-only)
  vendor session cannot call `create_organization_with_owner()` even though
  the DEFINER function bypasses RLS entirely; an AAL2 session succeeds
- Profiles: self read/update, protected `account_type` / `id` fields,
  no cross-user reads outside shared orgs, MFA optional at aal1
- Organizations: member-only reads, owner-only updates gated by AAL2, no
  direct inserts (must use `create_organization_with_owner`)
- **AAL1 owner cannot update organization settings**; **AAL2 owner can**
- Memberships: duplicate active membership prevention, manager cannot grant
  owner (even at aal2 — a role gate, not an MFA gate), self role change
  blocked, final-owner demotion/removal blocked, cross-org access blocked
- **AAL1 manager cannot insert members**; **AAL2 manager can add staff**
- **Owner cannot bypass MFA via a direct role-assignment DB request** at aal1
- **Forged-claim resistance**: extra/nested JWT claims
  (`is_aal2`, `user_metadata.aal`, `app_metadata.aal`) never grant aal2 —
  only the canonical top-level `aal` claim (set exclusively by Supabase
  Auth's own TOTP verify flow) is ever trusted
- Platform admins: self-read only, all writes rejected for the
  `authenticated` role; **`is_platform_admin()` requires AAL2** — an AAL1
  admin session sees no cross-tenant data at all

## Requirements

These tests need a local Supabase stack (Postgres + pgTAP), which requires
a **Docker-compatible container runtime** (Docker Desktop, OrbStack, Colima,
etc.) and the Supabase CLI. The CLI is installed as a project
`devDependency` (`npm install`), so no global install is required.

**Status:** as of the last hardening pass, no Docker-compatible runtime was
available in the authoring environment (no `docker`, `colima`, `podman`
binaries, and no Homebrew to install one), so these 46 assertions are
written and ready but have **not been executed**. Do not assume they pass —
run them (see below) before relying on this suite. The equivalent
behaviors are also unit-tested with mocks in `src/**` where practical
(`src/lib/auth/guards.test.ts`, `src/features/organizations/actions.test.ts`).

## Running

```bash
# one-time: npm install already fetched the local `supabase` devDependency

npm run db:start   # boots local Postgres + auth with migrations applied
npm run db:test    # runs every *.sql file in supabase/tests/
npm run db:lint    # static analysis of the schema
npm run db:stop
```

`supabase test db` (via `npm run db:test`) wraps each file in a transaction
and rolls it back, so tests never leave data behind.
