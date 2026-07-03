# User Flows

> **Note:** `docs/PRODUCT_SPEC.md` was not available when this document was
> written. Flows reflect the Phase 2 auth/tenancy scope and earlier
> placeholders.

## Authentication Flows (Implemented — Phase 2)

### Create account & verify email

1. User opens `/sign-up`, enters display name, email, password (≥10 chars).
2. Server action validates (Zod) and calls Supabase sign-up.
3. User lands on `/verify-email`; Supabase emails a confirmation link.
4. Link hits `/auth/confirm` (token verification server-side) → `/onboarding`.
5. Unverified users cannot sign in (clear error shown).

### Sign in / sign out

1. `/sign-in` with email + password. Invalid credentials show a generic error.
2. If the user has a verified MFA factor, they are sent to `/mfa-challenge`
   to enter a TOTP code before reaching any protected page (aal2).
3. Sanitized `next` param returns the user to their original destination.
4. Sign out from any signed-in page.

### Password reset

1. `/forgot-password` — always reports success (no email enumeration).
2. Email link → `/auth/confirm` (recovery) → `/reset-password`.
3. New password set server-side; user signs in again.
4. Expired/used links land on `/auth/error` with recovery options.

### Onboarding

1. First protected visit goes to `/onboarding`: **“What would you like to do
   first?”** — **Discover vendors** (customer path) or **Set up my vendor
   business** (vendor path). This sets `preferred_mode` (UI only); it is not
   permanent and can be changed from the header mode switch.
2. **Customer:** complete basic profile → `/customer` dashboard. Every
   authenticated user can use customer mode, including vendor members.
3. **Vendor — mandatory MFA sequence** (organization creation requires aal2):
   1. `/onboarding/vendor/profile` — personal profile (display name; initials
      avatar in UI).
   2. `/onboarding/vendor/mfa` — enroll TOTP and verify this session.
   3. `/onboarding/vendor` — organization details → atomic org + owner
      membership. Users may return to customer home before creating an org.
   4. `/vendor` dashboard (membership required).
4. **Become a vendor later:** same account → mode switch or account page →
   vendor onboarding (profile if needed → MFA → org).
5. Partially onboarded users resume via `resolveVendorOnboardingPath()`.

### Interface mode switch

Signed-in header toggle: **Customer** / **Vendor** (or **Become a vendor**
without membership). Updates `preferred_mode` only; vendor routes still require
active `organization_members` (server guards + RLS).

### Account & security

1. `/account` — display name, read-only email, initials avatar, preferred
   mode, organization summary, links to security and vendor setup.
2. `/account/security` — change password, TOTP MFA, sign out, sign out other
   sessions, recovery guidance.
3. `/mfa-enroll` — the mandatory-MFA redirect target when an organization
   owner/manager (or platform admin) with no enrolled factor attempts a
   sensitive action outside onboarding; returns to the original destination
   once enrollment is verified.
4. Organization owners/managers **cannot** reach `/vendor` at all without a
   verified MFA session (no grandfathering for existing accounts); platform
   admins are blocked from `/admin` until enrolled and verified.

## Customer Flows

### Discover vendors (planned)

**Phase 2:** `/customer` dashboard links to the `/discover` placeholder.
Full discovery, maps, and live locations arrive in a later phase.

## Vendor Flows

### List a business (implemented)

1. Vendor clicks "List Your Business" → account creation → personal profile
   → **mandatory MFA enrollment + verification** → organization created
   atomically → vendor dashboard.
2. Dashboard shows org details and the member roster (role-scoped: staff see
   only themselves). Owners/managers cannot reach the dashboard at all
   without a verified MFA session.

### Team management (partially implemented)

Database policies for invitations and role management exist (owners add any
role, managers add staff/managers, self-promotion impossible, final owner
protected). The invitation UI arrives in a later phase.

### Update live location / manage menu (planned)

Not implemented; later phases.

## Administrator Flows (foundation)

1. Admin (granted via migration/service role only) signs in with MFA.
2. `/admin` shows platform counts. Moderation tooling is a later phase.
3. Non-admins and unverified-MFA admins never reach `/admin` — enforced
   server-side and by RLS.

## Flows Explicitly Deferred

| Flow                     | Reason                           |
| ------------------------ | -------------------------------- |
| Payment / subscription   | Billing integration not in scope |
| SMS verification         | SMS not in scope                 |
| Loyalty redemption       | Transaction logic not in scope   |
| QR scan-to-discover      | QR module placeholder only       |
| Member invitation UI     | Later phase (DB policies ready)  |
| Admin-assisted MFA reset | Requires service-role tooling    |
