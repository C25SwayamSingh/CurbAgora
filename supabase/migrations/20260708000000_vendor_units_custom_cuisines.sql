-- ============================================================================
-- Vendor units: allow custom, vendor-entered cuisine tags alongside the
-- existing predefined categories, instead of forcing every value into the
-- fixed cuisine_category enum.
--
-- Forward migration on top of 20260706000000_vendor_units.sql /
-- 20260707000000_vendor_units_multi.sql: converts
-- vendor_units.cuisine_categories from public.cuisine_category[] to a plain
-- text[], preserving existing values (every enum value casts losslessly to
-- its own text label). The app layer (Zod, in
-- src/features/vendors/schemas.ts) is now the source of truth for
-- normalizing/deduplicating entries and for the list of predefined
-- suggestions; the database keeps only structural limits (entry count,
-- entry length) as defense in depth. Nothing in RLS, grants, or role checks
-- changes.
-- ============================================================================

-- The view depends on this column and must be dropped before the column's
-- type can change, then recreated identically (same pattern as the prior
-- multi-unit migration).
drop view public.vendor_unit_previews;

alter table public.vendor_units
  drop constraint vendor_units_cuisine_categories_limit;

alter table public.vendor_units
  alter column cuisine_categories type text[]
  using cuisine_categories::text[],
  alter column cuisine_categories set default '{}'::text[];

-- A plain CHECK expression cannot contain a subquery, so per-entry length
-- validation (unlike the simple array_length limit below) is expressed as
-- an immutable function instead.
create or replace function public.text_array_entries_within_length(
  arr text[], min_len int, max_len int
) returns boolean
language sql immutable as $$
  select coalesce(
    bool_and(char_length(entry) between min_len and max_len),
    true
  )
  from unnest(arr) as entry;
$$;

alter table public.vendor_units
  add constraint vendor_units_cuisine_categories_limit check (
    array_length(cuisine_categories, 1) is null or array_length(cuisine_categories, 1) <= 8
  ),
  add constraint vendor_units_cuisine_categories_entry_length check (
    public.text_array_entries_within_length(cuisine_categories, 1, 40)
  );

comment on column public.vendor_units.cuisine_categories is
  'Free-form cuisine tags: a mix of predefined suggestions (see '
  'CUISINE_CATEGORIES in src/features/vendors/schemas.ts) and custom '
  'vendor-entered values. Normalized (trimmed, deduplicated) and capped at '
  '8 entries by the app layer before insert/update; the entry-count and '
  'entry-length checks here are a structural backstop, not the primary '
  'validation.';

-- The enum is no longer referenced by any column.
drop type public.cuisine_category;

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
