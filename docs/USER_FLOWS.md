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

1. First protected visit goes to `/onboarding`: one-time choice of
   **customer** or **vendor** (permanent; enforced by DB trigger).
2. **Customer:** complete basic profile → `/customer` dashboard.
3. **Vendor — mandatory MFA sequence** (organization owners must be
   MFA-verified before they can create an org):
   1. `/onboarding/vendor/profile` — personal profile (display name,
      optional avatar).
   2. `/onboarding/vendor/mfa` — enroll a TOTP factor (QR + manual secret +
      first code) **and** verify it this session. Not optional and not
      skippable — the next step independently re-checks this.
   3. `/onboarding/vendor` — organization details (business name, legal
      name, URL slug) → org + initial owner membership created atomically
      in one DB transaction, itself independently rejecting the request if
      the session is not aal2. Duplicate submissions cannot create a second
      org.
   4. `/vendor` dashboard.
4. Partially onboarded users are always routed back to their next
   incomplete step (`resolveVendorOnboardingPath()`).

### Account & security

1. `/account` — edit display name and avatar URL (approved fields only).
2. `/account/security` — enroll TOTP (QR + manual secret + first code),
   remove a factor (requires MFA-verified session), sign out all other
   sessions.
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
