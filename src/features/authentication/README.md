# Authentication

User sign-up, sign-in, session management, profiles, and MFA for customers,
vendors, and administrators.

**Phase 2 status:** Implemented.

## Contents

- `schemas.ts` — Zod validation schemas for every auth form (server-enforced)
- `actions.ts` — Server actions: sign-up, sign-in, sign-out, password reset,
  profile updates, onboarding steps, and TOTP MFA
  (enroll/challenge/verify/unenroll, revoke other sessions)
- `action-state.ts` — Shared `useActionState` result shape
- `components/` — Client form components (accessible, loading states,
  duplicate-submit protection, password visibility toggles)

## Security notes

- All authorization decisions are made server-side (`src/lib/auth/guards.ts`)
  and at the database level (RLS); client state is never trusted.
- Redirect (`next`) parameters are validated against same-origin paths
  (`src/lib/auth/redirect.ts`).
- MFA uses Supabase TOTP only — no custom crypto. Assurance level (aal) is
  re-checked server-side on every request.
