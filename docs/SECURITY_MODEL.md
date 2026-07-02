# Security Model

## Credential Handling

### Public (browser-safe)

These variables may be prefixed with `NEXT_PUBLIC_` and referenced from client bundles:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_APP_ENV`

### Server-only (never in browser code)

These must **never** be imported into client components or exposed via `NEXT_PUBLIC_`:

- `SUPABASE_SERVICE_ROLE_KEY`
- Any payment provider secret keys (future phase)
- Any SMS provider credentials (future phase)

The Phase 2 application code never uses the service-role key. Privileged
operations (granting platform admins) happen via migrations or operator
tooling, outside the Next.js app.

### Fail-fast environment validation

`src/lib/supabase/env.ts` allows placeholder values only when
`NODE_ENV` is `development` or `test`. In any other environment, missing
Supabase configuration throws at startup, and non-https Supabase URLs are
rejected. A production deployment can never silently run half-configured.

## Supabase Access Patterns

| Context                              | Client module                 | Key used                             |
| ------------------------------------ | ----------------------------- | ------------------------------------ |
| Browser / Client Components          | `src/lib/supabase/client.ts`  | Anon key only                        |
| Server Components / Actions / Routes | `src/lib/supabase/server.ts`  | Anon key (RLS as the signed-in user) |
| Privileged admin operations          | Migrations / operator tooling | Service role key (never in app code) |

Sessions are cookie-based via `@supabase/ssr`. Server code always verifies
the user with `auth.getUser()` (validated against the auth server), never
the unverified local session payload.

## Role Hierarchy

| Role            | Source of truth                         | Scope                                                      |
| --------------- | --------------------------------------- | ---------------------------------------------------------- |
| Anonymous       | no session                              | Public pages only                                          |
| Customer        | `profiles.account_type = 'customer'`    | Own profile, customer dashboard                            |
| Vendor (no org) | `profiles.account_type = 'vendor'`      | Own profile, vendor onboarding                             |
| Staff           | `organization_members.role = 'staff'`   | Own membership + own org basics                            |
| Manager         | `organization_members.role = 'manager'` | Org roster; manage staff/managers (never owners)           |
| Owner           | `organization_members.role = 'owner'`   | Full org management                                        |
| Platform admin  | `platform_admins` row                   | Cross-tenant read + future moderation; requires MFA (aal2) |

`account_type` is a one-time onboarding choice enforced by a DB trigger —
it selects an experience, it does not grant data access by itself. All data
access flows from membership rows and the admin table, which clients cannot
self-assign.

### Platform admin design decision

Admin status lives in the dedicated `platform_admins` table — **not** in
profile fields, URL params, client state, or user-editable auth metadata.
The table has no insert/update/delete policies and revoked write grants for
`anon`/`authenticated`; rows can only be created via migrations or the
service-role key. `requirePlatformAdmin()` additionally requires an
MFA-verified (aal2) session.

## Tenant Isolation (RLS)

RLS is enabled on every table; the default is deny. Policy intent:

- **profiles** — users read/update their own row; co-members of an active
  shared org can read each other (for rosters); platform admins read all.
  No public/anonymous access; no client-side insert/delete. A trigger blocks
  changes to `id`, `created_at`, and any change of a non-null `account_type`.
- **organizations** — visible only to active members and platform admins.
  Updates: owners only, and protected fields (`created_by`, `id`,
  `created_at`) are trigger-locked. No insert policy: creation only via
  `create_organization_with_owner()`. No delete policy: archive via status.
- **organization_members** — members see their own rows; owners/managers see
  their org's roster; no cross-org visibility. Inserts: owners (any role) or
  managers (never `owner`); never for yourself; `invited_by` must equal the
  acting user. Updates/deletes: owners manage all; managers manage non-owner
  rows; anyone may leave. Triggers additionally block self role changes and
  demotion/removal of the final active owner (ownership transfer required).
- **platform_admins** — self-read only; no writes from app roles.
- **MFA-mandatory writes** — restrictive policies backed by
  `mfa_assurance_ok()` require an **unconditional** aal2 session for every
  organization update and organization-member insert/update/delete. Because
  only owners/managers can ever pass the corresponding permissive policy
  (`has_org_role(...)`) in the first place, this makes MFA mandatory — not
  optional — for those roles, entirely at the database layer (see "MFA"
  below for why this changed from the original "only if enrolled" behavior).

### SECURITY DEFINER functions

Every DEFINER function pins `SET search_path = public, pg_temp`, validates
`auth.uid()`, never accepts trusted role/org claims from the client, and
documents in-code why DEFINER is necessary (RLS recursion avoidance or
privileged reads such as `auth.mfa_factors`). Execute grants on
`create_organization_with_owner` are limited to `authenticated`.

`create_organization_with_owner()` bypasses RLS entirely (it runs with the
function owner's privileges), so the restrictive MFA policies on
`organizations`/`organization_members` never apply to it. It therefore
performs its own explicit `auth.jwt() ->> 'aal' = 'aal2'` check before doing
anything else — the only way to close that bypass for a DEFINER function.
Without this, initial organization creation could never be gated by MFA no
matter how the table-level RLS policies were written.

## MFA (Supabase TOTP) — mandatory for owners/managers and platform admins

MFA is **optional** for customers and staff, and **mandatory** for
organization owners/managers and platform administrators. There is no
custom, client-writable "is MFA verified" flag anywhere in the system —
every check reads Supabase Auth's own `aal` (Authenticator Assurance Level)
claim, which only the TOTP challenge/verify APIs can ever set to `aal2`.

| Role                   | MFA requirement                                                   |
| ---------------------- | ----------------------------------------------------------------- |
| Customer               | Optional                                                          |
| Vendor staff           | Optional (for now)                                                |
| Organization owner     | **Mandatory** — enroll + verify before creating/managing an org   |
| Organization manager   | **Mandatory** — enroll + verify before manager-level actions      |
| Platform administrator | **Always mandatory** — every admin-level read/write requires aal2 |

### Enrollment / challenge flow

- Enrollment, challenge, verification, and unenrollment use Supabase's TOTP
  APIs exclusively (`supabase.auth.mfa.*`) — no custom crypto, no custom
  verification state.
- `getAuthContext()` (`src/lib/auth/guards.ts`) loads `aal` and `mfaEnrolled`
  fresh on every request from
  `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` — never from client
  state, cookies, or profile fields.
- `enforceMfaVerified(ctx, nextPath)` is the single mandatory-MFA gate: if
  the session is not aal2, it redirects to `/mfa-enroll` (no verified factor
  yet) or `/mfa-challenge` (a factor is enrolled but this session has not
  verified it). Both pages return to `nextPath` (validated by
  `safeNextPath()`) once the step is complete.
- **Vendor onboarding sequence**
  (`requireVendorForOrgCreation`/`resolveVendorOnboardingPath`): 1) choose
  the vendor path (`/onboarding`) → 2) complete the personal profile
  (`/onboarding/vendor/profile`) → 3) enroll **and verify** MFA
  (`/onboarding/vendor/mfa`) → 4) create the organization atomically
  (`/onboarding/vendor`) → 5) vendor dashboard (`/vendor`). Step 4 is
  unreachable without a verified aal2 session, in both the guard and the
  database function.
- **Existing owners/managers without MFA**: `requireVendorDashboard()`
  blocks `/vendor` itself for owner/manager roles until MFA is verified —
  there is no grandfathering for accounts that predate this requirement.
  Staff access is unaffected.
- Platform admins: `requirePlatformAdmin()` requires aal2 unconditionally;
  `/admin` is unreachable without it. The database's `is_platform_admin()`
  also requires aal2, so any other policy using that function (profiles,
  organizations, organization_members reads) also stops recognizing an
  unverified admin session, independent of the app layer.
- Unenrollment requires an aal2 session.
- Recovery: users are advised to keep the manual TOTP secret as a backup; an
  admin-assisted factor reset is future work (service-role tooling).

### Independent, defense-in-depth enforcement

Frontend redirects are a UX convenience only — every layer re-verifies
independently so a bypass at one layer alone cannot grant access:

1. **Page guards** (`requireVendorForOrgCreation`, `requireVendorDashboard`,
   `requireVendorSensitiveAction`, `requirePlatformAdmin`) redirect before
   rendering.
2. **Server actions** independently call `enforceMfaVerified()` (or an
   equivalent guard) immediately before every sensitive write —
   `createOrganizationAction` is the concrete example today; the same
   pattern is the required entry point for future member-management,
   organization-settings, loyalty-configuration, customer-data-access, and
   billing-administration actions.
3. **Database** — restrictive RLS policies (`mfa_assurance_ok()`) require an
   aal2 JWT for organization/membership writes, and
   `create_organization_with_owner()` checks the JWT directly. A request
   that somehow skipped both app layers still cannot write.

### Sensitive operations requiring AAL2 (current and architected-for)

- Creating an organization + its initial owner membership (built)
- Updating organization settings (RLS ready; no settings UI yet)
- Inviting/adding/removing members, or changing member roles (RLS ready; no
  invitation UI yet)
- Assigning or removing manager/owner roles (RLS ready)
- Future: loyalty configuration, customer-data access, billing
  administration — must use `requireVendorSensitiveAction()` server-side and
  an AAL2-gated RLS policy at the database level when built.

## Application-layer protections

- **Open redirects** — `next`/redirect params validated against same-origin
  absolute paths (`src/lib/auth/redirect.ts`), including protocol-relative
  and backslash bypass tricks.
- **Mass assignment** — server actions write only whitelisted columns;
  authorization fields are additionally trigger-locked at the DB.
- **IDOR / cross-org** — all queries run under RLS as the signed-in user;
  IDs from the client cannot widen access.
- **Duplicate submissions** — submit buttons disable while pending;
  org creation is idempotent (existing owners are redirected, plus a unique
  slug constraint and unique live-membership index).
- **Email enumeration** — password reset always reports success; sign-up
  does not reveal whether an email already exists.
- **Validation** — all inputs re-validated server-side with Zod; the DB
  function re-validates again.
- **Error handling** — raw auth/database errors are logged server-side;
  users see generic, safe messages.

## Authorization Test Matrix

Enforced by `src/lib/auth/guards.test.ts` (server guards, mocked) and
`supabase/tests/001_rls_policies.sql` (database policies + AAL enforcement,
46 pgTAP assertions).

| Persona ↓ / Access →   | Own profile | Other profile   | Own org (read) | Own org (write)   | Other org | Org roster | Grant owner       | Change own role | Remove final owner | /admin |
| ---------------------- | ----------- | --------------- | -------------- | ----------------- | --------- | ---------- | ----------------- | --------------- | ------------------ | ------ |
| Anonymous              | ✗           | ✗               | ✗              | ✗                 | ✗         | ✗          | ✗                 | ✗               | ✗                  | ✗      |
| Customer               | ✓           | ✗               | ✗              | ✗                 | ✗         | ✗          | ✗                 | ✗               | ✗                  | ✗      |
| Vendor staff (any AAL) | ✓           | shared-org read | read           | ✗                 | ✗         | own row    | ✗                 | ✗               | ✗                  | ✗      |
| Vendor manager (aal1)  | ✓           | shared-org read | read           | ✗ (MFA required)  | ✗         | ✓ (read)   | ✗                 | ✗               | ✗                  | ✗      |
| Vendor manager (aal2)  | ✓           | shared-org read | read           | ✓ (non-owner)     | ✗         | ✓          | ✗                 | ✗               | ✗                  | ✗      |
| Vendor owner (aal1)    | ✓           | shared-org read | read           | ✗ (MFA required)  | ✗         | ✓ (read)   | ✗ (MFA required)  | ✗               | ✗                  | ✗      |
| Vendor owner (aal2)    | ✓           | shared-org read | read           | ✓                 | ✗         | ✓          | ✓                 | ✗               | ✗ (transfer first) | ✗      |
| Platform admin (aal1)  | ✓           | own only        | own org only   | ✗                 | ✗         | own org    | ✗ (no write path) | ✗               | ✗                  | ✗      |
| Platform admin (aal2)  | ✓           | read all        | read all       | ✗ (no write path) | read      | read       | ✗ (no write path) | ✗               | ✗                  | ✓      |

"MFA required" means the role holds the necessary permissions but the
database's restrictive `mfa_assurance_ok()` policy blocks the write until
the session is aal2 — this is enforced identically whether the write comes
from the app or a direct database request.

## Environment Separation

| Environment | Config file                         | Purpose                |
| ----------- | ----------------------------------- | ---------------------- |
| Local       | `.env.local`                        | Developer machines     |
| Staging     | `.env.staging` / hosting secrets    | Pre-production testing |
| Production  | `.env.production` / hosting secrets | Live users             |

Never commit real secrets. Example files (`.env.*.example`) contain placeholders only.

## CI/CD

GitHub Actions runs lint, typecheck, unit tests, and E2E tests. No
production secrets are required for CI; tests use placeholder Supabase
configuration. Database policy tests (`npm run db:test`, `npm run db:lint`)
require a local Supabase stack (Docker-compatible container runtime) and are
run by developers — see `supabase/tests/README.md`. They are not currently
part of the CI pipeline because CI runners in this environment do not have a
container runtime available; adding a `docker`-capable CI job to run
`npm run db:reset && npm run db:test && npm run db:lint` is recommended
follow-up work.

## Known Limitations

- The 46 pgTAP assertions in `supabase/tests/001_rls_policies.sql` are
  ready to run but require a local Docker-compatible stack — see
  `supabase/tests/README.md` for exact commands and current status.
- Manual end-to-end testing of the live auth flows (real sign-up email via
  Mailpit, real TOTP challenge, etc.) also requires that same local stack.
- Member invitation/management UI and organization-settings UI do not exist
  yet — the RLS policies and `requireVendorSensitiveAction()` guard are
  ready for them, but there is no current page/action exercising them
  end-to-end.
- Admin-assisted MFA factor recovery is not implemented (would require
  service-role tooling outside the app).

## Out of Scope (This Phase)

- Payment processing and PCI-related flows
- SMS delivery and phone verification
- Loyalty transaction processing
- Admin moderation tooling (secure shell only)
