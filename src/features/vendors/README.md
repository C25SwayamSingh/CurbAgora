# Vendors

Vendor unit setup and public preview for food carts, trucks, stands, stalls,
and pop-ups.

**Status:** an organization may operate any number of vendor units, each
editable by owners/managers, each with its own public preview page.

## What's here

- `schemas.ts` — field validation (including the per-org-unique `slug`) and
  the enum option lists (unit type, cuisine categories, payment methods,
  operating status) shared by the form and its labels. Also re-exports
  `suggestSlug` from the organizations feature (same slugify logic) and a
  small `labelFor` helper used by both the dashboard card and the public
  page.
- `actions.ts` — `createVendorUnitAction` / `updateVendorUnitAction`. Both
  require an authenticated owner/manager of the target organization; the
  organization is derived server-side from the caller's membership, never
  taken from client input. Update additionally scopes by the specific
  unit's id (from a hidden form field) _and_ the caller's organization_id,
  so a manager/owner of one organization can never edit another
  organization's unit.
- `components/vendor-unit-form.tsx` — shared create/edit form.
- `components/vendor-unit-card.tsx` — summary card for one vendor unit.
- `components/vendor-units-section.tsx` — dashboard section covering all
  three states (no units yet / one / several) plus "Add another vendor
  unit".

## Data model

`vendor_units` — an organization may have any number of rows. Each unit has
its own `slug`, unique only **within its organization** (two different
organizations may reuse the same unit slug). Public routing is
`/vendors/{organizations.slug}/{vendor_units.slug}`.

`vendor_unit_previews` is the only public read path: it nulls
`contact_phone`/`contact_email` unless their `*_visible` flag is set,
excludes units under a suspended/archived organization, and exposes
`organizations.slug` as `organization_slug` alongside the unit's own `slug`,
without exposing the organizations table itself.

See `supabase/migrations/20260706000000_vendor_units.sql` (initial,
one-per-org) and `supabase/migrations/20260707000000_vendor_units_multi.sql`
(forward migration lifting that limit and adding the per-org-unique slug —
written as an ALTER + backfill, not a drop/recreate, so it's safe to run
against a table that already has rows).

**Known follow-up, not built:** as multi-unit creation removes the natural
one-shot friction of "one business per org," some form of business-existence
verification (e.g. a linked website/listing check) before a unit is allowed
to go public may be worth adding later, with a manual/AI-assisted review
path for cases that can't be auto-verified. This is a product decision
flagged for later, not implemented here.

## Explicitly out of scope for this slice

Maps, live GPS, image uploads, menus, loyalty, reviews, team invitations,
SMS/email OTP, billing, and ordering.
