# Database policy tests (pgTAP)

Adversarial tests for Row Level Security policies, triggers, SECURITY DEFINER
functions, and mandatory MFA (AAL2) enforcement.

Migrations under test:

- `supabase/migrations/20260701000000_auth_tenancy_foundation.sql`
- `supabase/migrations/20260702000000_mfa_enforcement_hardening.sql`
- `supabase/migrations/20260702010000_grant_authenticated_table_privileges.sql`
- `supabase/migrations/20260703000000_preferred_mode_account_model.sql`
- `supabase/migrations/20260704000000_fix_membership_definer_triggers.sql`

## What is covered (51 assertions)

- Default deny for anonymous role
- **Mandatory MFA for organization creation** (AAL1 rejected; AAL2 succeeds;
  any authenticated user may bootstrap a tenant — membership grants vendor access)
- Profiles: self read/update, deprecated `account_type` immutability,
  `preferred_mode` user edits, cross-user isolation
- Organizations: member-only reads, owner updates gated by AAL2, no direct inserts
- Memberships: duplicate prevention, manager cannot grant owner, self role change
  blocked, final-owner removal blocked, cross-org isolation
- **AAL1 manager cannot insert members**; **AAL2 manager can add staff**
- **Forged JWT claims** never grant aal2
- Platform admins: self-read only; cross-tenant reads require AAL2
- Onboarding: `preferred_mode` is not permanently locked; deprecated
  `account_type` cannot be changed by clients

## Test harness

Helper functions at the top of `001_rls_policies.sql`:

| Helper                   | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `test_as_user(uid, aal)` | Sets `role=authenticated` and JWT claims (`sub`, `role`, `aal`) |
| `test_as_anon()`         | Anonymous context                                               |
| `test_as_service()`      | Postgres/service context for fixture setup                      |
| `test_rows_updated(sql)` | Counts rows matched by an UPDATE under current RLS              |

`test_as_user` clears prior JWT/role settings before applying a new session so
tests do not leak identity between assertions.

## Root cause fixed (2026-07-04)

Tests 26, 27, and 30 previously failed because `protect_membership_update`
and `protect_membership_delete` are **SECURITY DEFINER** (required to count
owners org-wide). Inside DEFINER functions, `current_user` is the function
owner (`postgres`), not `authenticated`, so the guard

```sql
if current_user in ('anon', 'authenticated')
```

never ran for API clients — self role changes and final-owner deletion were
not blocked.

**Fix:** migration `20260704000000_fix_membership_definer_triggers.sql` gates
on `current_setting('role', true)` instead, which remains `authenticated` for
client sessions. Test 26 now expects a trigger exception (`throws_ok`) rather
than a silent zero-row update.

## Running

```bash
npm run db:start
npm run db:reset   # apply all migrations to a clean local DB
npm run db:test    # 51 pgTAP assertions
npm run db:lint
```

`supabase test db` wraps each file in a transaction and rolls back, so tests
never leave data behind.
