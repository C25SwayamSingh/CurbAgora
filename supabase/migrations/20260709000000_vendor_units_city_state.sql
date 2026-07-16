-- ============================================================================
-- Vendor units: add state (2-letter USPS code) and an optional neighborhood/
-- service-area label alongside the existing free-text city.
--
-- Forward migration on top of 20260706000000_vendor_units.sql /
-- 20260707000000_vendor_units_multi.sql / 20260708000000_vendor_units_custom_cuisines.sql.
-- `state` is left nullable here to preserve existing rows without a
-- backfill guess; the app layer requires it going forward for new/edited
-- units (same pattern as how `slug` was introduced as a required app-layer
-- field before later migrations tightened the column itself). Nothing in
-- RLS, grants, or role checks changes.
-- ============================================================================

alter table public.vendor_units
  add column state text,
  add column neighborhood text;

alter table public.vendor_units
  add constraint vendor_units_state_format check (state is null or state ~ '^[A-Z]{2}$'),
  add constraint vendor_units_neighborhood_length check (
    neighborhood is null or char_length(neighborhood) <= 120
  );

comment on column public.vendor_units.state is
  '2-letter USPS state code. Nullable for rows created before this column '
  'existed; required by the app layer (Zod) for new/edited units.';

comment on column public.vendor_units.neighborhood is
  'Optional free-text service-area/neighborhood label shown alongside '
  'city/state on the public page, e.g. "Downtown" or "East Side food '
  'truck park". Not geocoded or verified — city/state are.';

-- The view depends on this table's column list and must be dropped before
-- new columns can be inserted mid-list (create-or-replace only allows
-- appending), then recreated identically plus the two new columns.
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
  vu.state,
  vu.neighborhood,
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
