# Build Phases

> **Note:** `docs/PRODUCT_SPEC.md` was not available when this document was
> written. Phases reflect the stated requirements and domain modules.

## Phase 1 — Foundation (Complete)

**Goal:** Establish project structure, tooling, design system, and documentation.

- [x] Next.js app (TypeScript, App Router)
- [x] Tailwind CSS and shadcn/ui, mobile-first design system
- [x] Supabase configuration placeholders
- [x] Environment variable examples (local, staging, production)
- [x] Feature module folder structure (12 domains)
- [x] ESLint, Prettier, Vitest, RTL, Playwright, GitHub Actions CI
- [x] Landing page with customer/vendor value props and CTAs

## Phase 2 — Authentication & Tenancy (Current — Complete)

**Goal:** Secure accounts, profiles, organizations, roles, mandatory MFA for
leadership roles, and database-level tenant isolation.

### Delivered

- [x] Supabase Auth via @supabase/ssr cookie sessions (browser/server clients)
- [x] Fail-fast environment validation outside development
- [x] `src/proxy.ts` (Next.js 16 proxy convention) session refresh + coarse
      route guards
- [x] Server-side guard utilities (auth, onboarding, roles, admin, MFA/aal)
- [x] Versioned migrations: profiles, organizations, organization_members,
      platform_admins — RLS default-deny on all tables
- [x] Atomic org + initial-owner creation (DB function, single transaction)
- [x] Final-owner protection, self-role-change block, duplicate-membership
      prevention, protected authorization fields (DB triggers/policies)
- [x] Platform admin model (dedicated table, service-role/migration writes only)
- [x] Sign-up, email verification, sign-in/out, password reset flows
- [x] Customer and vendor onboarding (account-type choice, org creation)
- [x] Account profile + security pages; sign out other sessions
- [x] TOTP MFA: enroll, challenge, verify, unenroll
- [x] **Mandatory MFA (aal2) for organization owners/managers and platform
      admins** — independently enforced in server guards, sensitive server
      actions, and database RLS/functions (not merely "if enrolled")
- [x] Vendor onboarding secure sequence: profile → MFA enroll/verify → org
      creation → dashboard
- [x] Zod server-side validation; open-redirect protection; safe errors
- [x] Unit tests (guards matrix, actions, schemas, redirects), 46 pgTAP
      RLS/AAL tests, Playwright route-protection E2E
- [x] Documentation updates

### Not in Phase 2

- Member invitation/management UI (DB policies + AAL2 guard ready)
- Organization-settings UI (DB policies + AAL2 guard ready)
- Admin moderation tooling (secure `/admin` shell only)
- Admin-assisted MFA recovery tooling
- Vendor units/brands, menus, locations, loyalty, reviews, billing
- CI execution of the pgTAP suite (requires a Docker-capable runner; not
  configured in this environment)

## Phase 3 — Vendor Presence & Team Management (Planned)

- Organization member invitation and role management UI
- Basic vendor profile CRUD (public-facing vendor pages)
- Admin user/org management tooling (service-role backed)

## Phase 4 — Discovery & Live Locations (Planned)

- Customer discovery UI, map integration, search and filtering
- Vendor live location updates

## Phase 5 — Menus, Reviews & QR (Planned)

- Menu management and public display
- Review submission and display
- QR code generation and scanning

## Phase 6 — Loyalty, Ambassadors, Billing & Administration (Planned)

- Loyalty program configuration and transactions
- Ambassador referral tracking
- Subscription billing and payment processing
- Full admin dashboard and moderation tools

## Dependencies Between Phases

```
Phase 1 (Foundation)
    └── Phase 2 (Auth & Tenancy)  ← current
            └── Phase 3 (Vendor Presence & Teams)
                    ├── Phase 4 (Discovery & Locations)
                    ├── Phase 5 (Menus, Reviews, QR)
                    └── Phase 6 (Loyalty, Billing, Admin)
```

Update this document when `docs/PRODUCT_SPEC.md` is available.
