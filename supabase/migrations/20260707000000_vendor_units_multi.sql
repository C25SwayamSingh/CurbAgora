-- ============================================================================
-- Vendor units: allow an organization to operate more than one unit (cart,
-- truck, stand, stall, pop-up) instead of exactly one.
--
-- This is a forward migration on top of 20260706000000_vendor_units.sql: it
-- ALTERs the existing table and backfills existing rows rather than
-- dropping/recreating anything, so it is safe to run against a table that
-- already has data (local test fixtures today; real vendor data once this
-- ships). Nothing in RLS, grants, or role checks changes — has_org_role()
-- already scoped writes to owner/manager of the *target* organization
-- regardless of how many units that organization has; only the "exactly
-- one" constraint is being lifted.
--
-- Known follow-up, NOT built here (out of scope for this change): as
-- multi-unit creation removes the natural one-shot friction of "one
-- business per org," some form of business-existence verification (e.g. a
-- linked website/business-listing check) before a unit is allowed to go
-- public may be worth adding later, with a manual/AI-assisted review path
-- for cases that can't be auto-verified. Tracked as a product decision, not
-- implemented in this migration.
-- ============================================================================

-- One organization may now own many vendor units.
drop index public.vendor_units_one_per_org;

-- Each unit gets its own slug, unique only within its organization (two
-- different organizations may use the same unit slug — public routing
-- disambiguates by organization first, then unit).
alter table public.vendor_units add column slug text;

-- Backfill: derive a slug from each existing row's name, matching the
-- app's suggestSlug() normalization (lowercase, non-alphanumeric runs
-- collapsed to a single hyphen, leading/trailing hyphens trimmed), falling
-- back to a generic value if a name has no alphanumeric characters at all,
-- and disambiguating same-organization collisions with a numeric suffix.
with normalized as (
  select
    id,
    organization_id,
    created_at,
    coalesce(
      nullif(regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''),
      'vendor'
    ) as base_slug
  from public.vendor_units
),
numbered as (
  select
    id,
    base_slug,
    row_number() over (partition by organization_id, base_slug order by created_at, id) as rn
  from normalized
)
update public.vendor_units vu
set slug = case when numbered.rn = 1 then numbered.base_slug
                else numbered.base_slug || '-' || numbered.rn::text end
from numbered
where numbered.id = vu.id;

alter table public.vendor_units alter column slug set not null;

alter table public.vendor_units
  add constraint vendor_units_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46})[a-z0-9]$');

-- Uniqueness is per-organization, not global.
create unique index vendor_units_org_slug_unique on public.vendor_units (organization_id, slug);

comment on column public.vendor_units.slug is
  'URL-safe identifier for this unit, unique within its organization only. '
  'Public URL is /vendors/{organizations.slug}/{vendor_units.slug}.';

-- ----------------------------------------------------------------------------
-- Public preview view: same masking/filtering rules as before (contact
-- fields nulled unless *_visible; suspended/archived organizations
-- excluded), now also exposing each unit's own slug so a public URL can
-- resolve to one specific unit instead of "the organization's one unit."
-- Dropped and recreated (not create-or-replace) because a new column is
-- being inserted rather than appended, which create-or-replace disallows.
-- ----------------------------------------------------------------------------

drop view public.vendor_unit_previews;

create view public.vendor_unit_previews as
select
  vu.id,
  vu.organization_id,
  o.slug as organization_slug,
  vu.slug,
  vu.name,
  vu.unit_type,
  vu.description,
  vu.cuisine_categories,
  vu.city,
  vu.payment_methods,
  vu.operating_status,
  case when vu.contact_phone_visible then vu.contact_phone else null end as contact_phone,
  case when vu.contact_email_visible then vu.contact_email else null end as contact_email,
  vu.created_at,
  vu.updated_at
from public.vendor_units vu
join public.organizations o on o.id = vu.organization_id
where o.status = 'active';

comment on view public.vendor_unit_previews is
  'Public, unauthenticated-safe projection of vendor_units: contact fields '
  'are nulled unless their *_visible flag is set, and only units under an '
  'active organization are included. Exposes organizations.slug as '
  'organization_slug and the unit''s own slug, together forming the public '
  'URL /vendors/{organization_slug}/{slug}. Runs with the view owner''s '
  'privileges (no security_invoker), which is what lets it read across '
  'every organization despite the member-only RLS on vendor_units and '
  'organizations — this is intentional and is the only public read path '
  'for vendor unit data.';

grant select on public.vendor_unit_previews to anon, authenticated;
