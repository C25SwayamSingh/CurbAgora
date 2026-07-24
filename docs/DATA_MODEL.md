# Data Model

> **Note:** `docs/PRODUCT_SPEC.md` was not available when this document was
> written. Entities reflect the Phase 2 auth/tenancy scope only.

## Implemented Tables (Phase 2)

Defined in `supabase/migrations/20260701000000_auth_tenancy_foundation.sql`,
with MFA/AAL2 enforcement hardened in
`supabase/migrations/20260702000000_mfa_enforcement_hardening.sql`. Typed
access in `src/lib/supabase/database.types.ts`.

### profiles

One row per auth user, created automatically by the `handle_new_user`
trigger on `auth.users`. Never stores passwords or auth secrets.

| Column                  | Type                                              | Notes                                                          |
| ----------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| id                      | uuid PK → auth.users                              | Immutable (trigger-protected)                                  |
| display_name            | text                                              | ≤120 chars                                                     |
| avatar_url              | text nullable                                     | Legacy field; UI uses initials until Storage uploads           |
| account_type            | enum `customer` \| `vendor`, nullable             | **Deprecated** — retained for migration; clients cannot change |
| preferred_mode          | enum `customer` \| `vendor`                       | Non-authoritative UI preference; user-editable                 |
| onboarding_status       | enum `not_started` \| `in_progress` \| `complete` |                                                                |
| created_at / updated_at | timestamptz                                       | `updated_at` maintained by trigger                             |

### organizations

Vendor tenants. Created **only** via the `create_organization_with_owner()`
DB function (no direct insert policy), so an org can never exist without an
active owner.

| Column                  | Type                                       | Notes                                 |
| ----------------------- | ------------------------------------------ | ------------------------------------- |
| id                      | uuid PK                                    |                                       |
| legal_name              | text                                       | 2–200 chars                           |
| display_name            | text                                       | 2–120 chars                           |
| slug                    | text unique                                | `^[a-z0-9]([a-z0-9-]{0,46})[a-z0-9]$` |
| status                  | enum `active` \| `suspended` \| `archived` | No delete policy; archive via status  |
| created_by              | uuid → auth.users                          | Immutable (trigger-protected)         |
| created_at / updated_at | timestamptz                                |                                       |

### organization_members

| Column                  | Type                                    | Notes                                           |
| ----------------------- | --------------------------------------- | ----------------------------------------------- |
| id                      | uuid PK                                 |                                                 |
| organization_id         | uuid → organizations (cascade)          | Immutable per row                               |
| user_id                 | uuid → auth.users (cascade)             | Immutable per row                               |
| role                    | enum `owner` \| `manager` \| `staff`    | Self role change blocked; final owner protected |
| status                  | enum `invited` \| `active` \| `revoked` |                                                 |
| invited_by              | uuid → auth.users, nullable             | Must equal acting user on insert                |
| created_at / updated_at | timestamptz                             |                                                 |

Partial unique index `(organization_id, user_id) where status <> 'revoked'`
prevents duplicate live memberships.

### platform_admins

Platform-level administrator allowlist. **No** insert/update/delete RLS
policies and revoked write grants: writable only via migrations or the
service-role key. Users can read only their own row.

| Column     | Type                 |
| ---------- | -------------------- |
| user_id    | uuid PK → auth.users |
| granted_by | uuid nullable        |
| note       | text nullable        |
| created_at | timestamptz          |

## Database Functions

| Function                         | Purpose                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `create_organization_with_owner` | Atomic org + active owner membership; requires aal2 (any authenticated user) |
| `is_platform_admin`              | RLS helper (avoids recursion; reads platform_admins); requires aal2          |
| `is_org_member` / `has_org_role` | RLS helpers for membership/role checks                                       |
| `shares_active_org`              | Lets co-members read each other's display names                              |
| `mfa_assurance_ok`               | Requires aal2 unconditionally — restrictive policy on org/membership writes  |
| `handle_new_user`                | Creates a profile row per new auth user                                      |
| `protect_*` triggers             | Field immutability, self-role-change block, final-owner protection           |

All SECURITY DEFINER functions pin `search_path = public, pg_temp`, key
decisions off `auth.uid()`, and carry in-code comments explaining why
DEFINER is required.

## Relationships

```
auth.users 1──1 profiles
auth.users 1──* organization_members *──1 organizations
auth.users 0──1 platform_admins
```

## Conventions

- Primary keys: UUID (`gen_random_uuid()`)
- Timestamps: `created_at`, `updated_at` (trigger-maintained) on mutable tables
- RLS enabled on **every** table; no policy ⇒ no access (default deny)
- Enum types for all constrained values

## Loyalty (Implemented)

Spend-based points. Full rationale in `docs/decisions/loyalty-system.md`.

| Table                          | Role                                             |
| ------------------------------ | ------------------------------------------------ |
| `loyalty_programs`             | One per organization; pause switches             |
| `loyalty_program_versions`     | Immutable rule snapshots; `points_per_dollar`    |
| `loyalty_reward_catalog_items` | Point-priced rewards per version                 |
| `loyalty_accounts`             | Customer×org balance projection                  |
| `loyalty_ledger_entries`       | Append-only truth; every balance derives from it |
| `loyalty_claim_codes`          | **Checkout sessions** (see below)                |
| `loyalty_redemptions`          | Reward reservations, own 6-character code        |
| `loyalty_checkout_lookups`     | Identification-attempt audit log                 |

`loyalty_claim_codes` keeps its stamp-era name because
`loyalty_ledger_entries.claim_code_id` references it and that audit trail must
survive. It now models a **checkout session**: `token_digest` (SHA-256 of the
opaque QR token — the raw token is never stored), `numeric_code` (4 digits,
unique among active sessions per org), `vendor_unit_id` (audit context only;
programs are per-organization), `failed_attempts`, and `invalidated_reason`.

Status values stay lowercase so historical rows remain valid:
`pending` = ACTIVE, `confirmed` = CONSUMED, plus `expired`, `cancelled`, and
`locked`. Legacy 6-character `code` values are preserved and no longer issued.

## Planned (Later Phases)

Menus, reviews, ambassadors, billing, moderation records, POS integration —
to be specified alongside `docs/PRODUCT_SPEC.md`.
