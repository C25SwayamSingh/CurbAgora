-- ============================================================================
-- Vendor location sessions: a vendor unit "going live" at a physical point
-- for some duration (e.g. "Go live at my current location"). A session is
-- considered LIVE only while both true: it has not been manually ended
-- (ended_at is null) AND it was recently confirmed (last_confirmed_at is
-- within vendor_location_session_stale_after() of now()) — computed at
-- read time in vendor_location_session_previews below, never trusted from
-- a stored boolean. This lets a session go stale (e.g. the vendor closed
-- their laptop) without any background job: it simply stops appearing to
-- the public on its own.
--
-- Any active member of the unit's organization (owner, manager, or staff)
-- may start/update/end a session — this mirrors vendor_units' own write
-- model in spirit (an operational action, not a sensitive management
-- change) but is intentionally NOT owner/manager-only like vendor_units
-- CRUD, since "going live" needs to work for whoever is actually staffing
-- the cart that day. This codebase's membership model has exactly three
-- roles (owner/manager/staff) with no finer-grained per-member permission
-- flag; if one is ever needed, the additive path is a single nullable
-- `can_manage_locations boolean not null default true` column on
-- organization_members, checked by a new helper alongside is_org_member —
-- not built here since nothing in the spec asks for it yet.
--
-- Coordinates are plain double precision (WGS84 decimal degrees), NOT
-- PostGIS geography — this project has no PostGIS extension enabled
-- anywhere and installing it is out of scope for this pass. A later
-- migration can add PostGIS without restructuring anything already here,
-- e.g.:
--   create extension if not exists postgis;
--   alter table vendor_location_sessions add column location geography(point, 4326)
--     generated always as (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) stored;
--   create index ... using gist (location);
-- ============================================================================

create table public.vendor_location_sessions (
  id uuid primary key default gen_random_uuid(),
  vendor_unit_id uuid not null references public.vendor_units (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  public_label text not null default '',
  started_at timestamptz not null default now(),
  expected_end_at timestamptz,
  last_confirmed_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_location_sessions_latitude_range check (latitude between -90 and 90),
  constraint vendor_location_sessions_longitude_range check (longitude between -180 and 180),
  constraint vendor_location_sessions_public_label_length check (char_length(public_label) <= 140),
  constraint vendor_location_sessions_expected_end_after_start check (
    expected_end_at is null or expected_end_at > started_at
  ),
  constraint vendor_location_sessions_confirmed_not_before_start check (
    last_confirmed_at >= started_at
  ),
  constraint vendor_location_sessions_ended_not_before_start check (
    ended_at is null or ended_at >= started_at
  )
);

comment on table public.vendor_location_sessions is
  'A vendor unit "going live" at a physical location for some duration. '
  'Liveness (not ended AND recently confirmed) is computed at read time — '
  'see vendor_location_session_previews — never stored as a flag.';

-- At most one OPEN (not manually ended) session per unit. Starting a new
-- session while one is already open is a client-driven two-step (end the
-- old one, then insert the new one) rather than implicit auto-ending, so
-- the audit trail never silently rewrites a prior session's end time.
create unique index vendor_location_sessions_one_open_per_unit
  on public.vendor_location_sessions (vendor_unit_id)
  where ended_at is null;

create index vendor_location_sessions_org_idx
  on public.vendor_location_sessions (organization_id);

create trigger vendor_location_sessions_set_updated_at
  before update on public.vendor_location_sessions
  for each row execute function public.set_updated_at();

-- Single source of truth for the staleness window, referenced by the
-- public view below (and by any future query that needs the same
-- liveness definition) instead of inlining the interval literal.
create or replace function public.vendor_location_session_stale_after()
returns interval
language sql
immutable
as $$
  select interval '30 minutes';
$$;

comment on function public.vendor_location_session_stale_after() is
  'How long a vendor_location_sessions row stays "live" after its last '
  'last_confirmed_at update, with no manual end. Centralized here so the '
  'window can change in one place.';

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.vendor_location_sessions enable row level security;

create policy "vendor_location_sessions_select_member"
  on public.vendor_location_sessions for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());

-- The exists(...) re-check against vendor_units is required, not optional:
-- organization_id is denormalized onto this table (for RLS simplicity,
-- matching vendor_units' own style), so without re-deriving it from
-- vendor_unit_id a caller could submit a vendor_unit_id belonging to a
-- DIFFERENT org than the organization_id they're legitimately a member
-- of — is_org_member(organization_id) alone would pass (it's checking
-- the attacker's own, real org), silently misattributing a session
-- cross-tenant. This closes that path.
create policy "vendor_location_sessions_insert_member"
  on public.vendor_location_sessions for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_org_member(organization_id)
    and exists (
      select 1 from public.vendor_units vu
      where vu.id = vendor_unit_id
        and vu.organization_id = vendor_location_sessions.organization_id
    )
  );

create policy "vendor_location_sessions_update_member"
  on public.vendor_location_sessions for update to authenticated
  using (public.is_org_member(organization_id))
  with check (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.vendor_units vu
      where vu.id = vendor_unit_id
        and vu.organization_id = vendor_location_sessions.organization_id
    )
  );

-- No delete policy: sessions are ended via ended_at, never hard-deleted —
-- matches vendor_units/organizations' "archive via status field" style.

grant select, insert, update on public.vendor_location_sessions to authenticated;
grant select on public.vendor_location_sessions to anon;

-- ----------------------------------------------------------------------------
-- Public view: row-per-CURRENTLY-LIVE-session (0 or 1 row per unit, since
-- the partial unique index above guarantees at most one open session per
-- unit, and staleness only shrinks that further to 0 or 1). A separate
-- view from vendor_unit_previews (not a join bolted onto it) so this can
-- evolve independently — e.g. later gain a PostGIS index for a "nearby"
-- query — without touching the unit-listing preview other pages depend
-- on. A unit's public page looks this up by vendor_unit_id; absence of a
-- row means "no active session — show only the base city/state", never a
-- stale coordinate, since ended/stale/suspended-org sessions never appear
-- here regardless of what the base table still holds.
-- ----------------------------------------------------------------------------

create view public.vendor_location_session_previews as
select
  vls.id,
  vls.vendor_unit_id,
  vls.organization_id,
  o.slug as organization_slug,
  vu.slug as unit_slug,
  vls.latitude,
  vls.longitude,
  vls.public_label,
  vls.started_at,
  vls.expected_end_at
from public.vendor_location_sessions vls
join public.vendor_units vu on vu.id = vls.vendor_unit_id
join public.organizations o on o.id = vls.organization_id
where o.status = 'active'
  and vls.ended_at is null
  and vls.last_confirmed_at > now() - public.vendor_location_session_stale_after();

comment on view public.vendor_location_session_previews is
  'Public, unauthenticated-safe feed of CURRENTLY LIVE location sessions '
  'only: a row appears here iff ended_at is null AND last_confirmed_at is '
  'within vendor_location_session_stale_after() of now(), recomputed on '
  'every read, and only for units under an active organization. Ended or '
  'stale sessions simply do not appear.';

grant select on public.vendor_location_session_previews to anon, authenticated;
