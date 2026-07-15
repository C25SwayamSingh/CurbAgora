-- ============================================================================
-- Vendor units: the first public-facing business listing for an organization
-- (food cart / food truck / stand / stall / pop-up). One organization has at
-- most one vendor unit in this phase (see vendor_units_one_per_org below).
--
-- Security posture, matching the rest of this schema:
--   * RLS enabled, default deny. Only active org members (owner/manager for
--     writes, any active member for reads) can touch the base table.
--   * Public visibility does NOT come from a public RLS policy on the base
--     table — there is none. It comes from a separate view,
--     vendor_unit_previews, that runs with the view owner's privileges
--     (the default for a plain view; no security_invoker), so it can read
--     across every organization's units regardless of the member-only RLS
--     above. This is the ONLY public read path.
--   * contact_phone/contact_email are always stored (the owner/manager
--     always sees them in their own dashboard) but the public view nulls
--     each one out unless its own *_visible flag is set — enforced in the
--     view's SELECT list, not left to the application to remember, so a
--     direct API request against the view can never leak a hidden contact
--     field.
--   * The public view also filters out units belonging to a suspended/
--     archived organization, so existing platform moderation
--     (organizations.status) still hides a listing without any new policy
--     on the organizations table itself.
--   * No changes to any existing table, policy, function, or grant.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enumerated types
-- ----------------------------------------------------------------------------

create type public.vendor_unit_type as enum (
  'food_cart',
  'food_truck',
  'stand',
  'stall',
  'pop_up'
);

create type public.vendor_operating_status as enum (
  'open',
  'closed',
  'temporarily_closed'
);

create type public.cuisine_category as enum (
  'american',
  'mexican',
  'asian',
  'italian',
  'mediterranean',
  'indian',
  'bbq',
  'desserts',
  'coffee_and_drinks',
  'vegan_vegetarian',
  'other'
);

create type public.payment_method as enum (
  'cash',
  'credit_card',
  'debit_card',
  'mobile_pay',
  'contactless'
);

-- ----------------------------------------------------------------------------
-- Table
-- ----------------------------------------------------------------------------

create table public.vendor_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  unit_type public.vendor_unit_type not null,
  description text not null default '',
  cuisine_categories public.cuisine_category[] not null default '{}',
  city text not null,
  contact_phone text,
  contact_phone_visible boolean not null default false,
  contact_email text,
  contact_email_visible boolean not null default false,
  payment_methods public.payment_method[] not null default '{}',
  operating_status public.vendor_operating_status not null default 'open',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_units_name_length check (char_length(name) between 2 and 120),
  constraint vendor_units_description_length check (char_length(description) <= 280),
  constraint vendor_units_city_length check (char_length(city) between 1 and 120),
  constraint vendor_units_contact_phone_length check (contact_phone is null or char_length(contact_phone) <= 32),
  constraint vendor_units_contact_email_length check (contact_email is null or char_length(contact_email) <= 254),
  constraint vendor_units_contact_email_format check (
    contact_email is null or contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  constraint vendor_units_cuisine_categories_limit check (
    array_length(cuisine_categories, 1) is null or array_length(cuisine_categories, 1) <= 5
  ),
  constraint vendor_units_payment_methods_limit check (
    array_length(payment_methods, 1) is null or array_length(payment_methods, 1) <= 6
  )
);

comment on table public.vendor_units is
  'Public business listing for a vendor organization. One per organization '
  'in this phase (vendor_units_one_per_org). Contact fields are always '
  'stored but only ever shown publicly through vendor_unit_previews, which '
  'nulls them per their *_visible flag.';

-- At most one vendor unit per organization for this phase. Relax (drop this
-- index) when multi-unit support ships — nothing else in this schema or its
-- policies assumes a single unit, so that future change is additive.
create unique index vendor_units_one_per_org on public.vendor_units (organization_id);

create trigger vendor_units_set_updated_at
  before update on public.vendor_units
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: default deny. Reads for active org members only; writes for
-- owner/manager only (matches the role split already used for organization
-- membership management — staff can view their own org's unit but not
-- change it).
-- ----------------------------------------------------------------------------

alter table public.vendor_units enable row level security;

create policy "vendor_units_select_member"
  on public.vendor_units for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());

create policy "vendor_units_insert_owner_manager"
  on public.vendor_units for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.has_org_role(organization_id, array['owner', 'manager']::public.organization_role[])
  );

create policy "vendor_units_update_owner_manager"
  on public.vendor_units for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'manager']::public.organization_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'manager']::public.organization_role[]));

-- No delete policy this phase (matches organizations: archive via status
-- fields instead, not a hard delete).

grant select, insert, update on public.vendor_units to authenticated;
-- Anon may attempt reads; RLS default-deny returns zero rows (same
-- philosophy as every other table in this schema — never expose data via
-- missing table privileges, which would surface as a permission error).
grant select on public.vendor_units to anon;

-- ----------------------------------------------------------------------------
-- Public preview: the only path anonymous visitors ever read vendor unit
-- data through. See the security-posture comment at the top of this file.
-- ----------------------------------------------------------------------------

-- Reuses organizations.slug (already unique, already chosen at org-creation
-- time) as the public URL key for /vendors/[slug] — vendor_units has no
-- slug of its own, avoiding a second, redundant "URL name" field in the
-- vendor unit form. Only that single column is exposed from organizations
-- here, not the row itself; the organizations table remains untouched and
-- unreadable by anon exactly as before this migration.
create view public.vendor_unit_previews as
select
  vu.id,
  vu.organization_id,
  o.slug as organization_slug,
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
  'organization_slug (the public URL key) without exposing the '
  'organizations row itself. Runs with the view owner''s privileges (no '
  'security_invoker), which is what lets it read across every organization '
  'despite the member-only RLS on vendor_units and organizations — this is '
  'intentional and is the only public read path for vendor unit data.';

grant select on public.vendor_unit_previews to anon, authenticated;
