# Organizations

Vendor organizations (tenants), memberships, and roles.

**Phase 2 status:** Organization creation with atomic initial-owner
assignment is implemented. Member invitations and management UI are planned
for a later phase (the database policies for them already exist).

## Contents

- `schemas.ts` — Zod validation (names, slug format) + slug suggestion helper
- `actions.ts` — `createOrganizationAction`: delegates to the
  `create_organization_with_owner` database function so the organization and
  its active owner membership are created in one transaction (an ownerless
  organization can never exist)
- `components/create-organization-form.tsx` — Vendor onboarding form

## Roles

| Role    | Can do                                                                 |
| ------- | ---------------------------------------------------------------------- |
| owner   | Manage org details and all memberships (cannot demote the final owner) |
| manager | View roster, add/manage manager & staff members (never owners)         |
| staff   | View own membership and org basics                                     |

All role enforcement lives in RLS policies and DB triggers — see
`supabase/migrations/` and `docs/SECURITY_MODEL.md`.
