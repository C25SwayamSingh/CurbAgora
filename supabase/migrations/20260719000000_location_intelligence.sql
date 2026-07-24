-- ============================================================================
-- Location intelligence: four states, kept distinguishable
-- ============================================================================
-- Discovery could previously answer exactly one question — who is live right
-- now — so a customer opening the app at 9am saw an empty map even where a cart
-- reliably parks every weekday at 11. This adds the three other kinds of
-- location knowledge, without letting them impersonate each other:
--
--   VENDOR LIVE          a vendor is sharing a location right now
--   SCHEDULED OCCURRENCE someone confirmed a specific date, time, and place
--   RECURRING LOCATION   a vendor confirmed a repeating pattern
--   HOTSPOT              a dataset says carts operate here; nobody is confirmed
--
-- The governing rule is that a hotspot is NOT a vendor. A municipal permit
-- record is evidence that vending is allowed somewhere, not that anyone is
-- there — labelling it "open now" would be a lie the customer physically walks
-- to. Everything below exists to keep that distinction structural rather than
-- a matter of UI discipline.
--
-- No PostGIS. This project deliberately runs haversine over plain lat/lng
-- (see 20260712000000_nearby_live_vendors.sql), so hotspots store a centroid
-- for ranking and keep any polygon as opaque GeoJSON for provenance/display.
-- Adding a spatial extension for a boundary nothing queries would be a real
-- deployment dependency bought for nothing.
--
-- Forward-only. No existing location row is read, altered, or deleted; the
-- live-session table and its public view are untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shared vocabulary
-- ---------------------------------------------------------------------------
-- Enums rather than text: the four states must never be comparable by accident,
-- and a typo'd source string must fail at write time rather than quietly
-- becoming an unrecognised category at read time.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'location_source_type') then
    create type public.location_source_type as enum (
      'VENDOR_LIVE',
      'VENDOR_RECURRING',
      'VENDOR_SCHEDULED',
      'EVENT_ORGANIZER',
      'MUNICIPAL_OPEN_DATA',
      'THIRD_PARTY_SCHEDULE',
      'SOCIAL_MEDIA_LEAD',
      'COMMUNITY_REPORT'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'location_verification') then
    create type public.location_verification as enum (
      'CONFIRMED',   -- the vendor or an authoritative source affirmed it
      'EXPECTED',    -- a confirmed pattern says so, but not for this moment
      'UNVERIFIED',  -- imported or reported; no human has judged it
      'STALE',       -- was confirmed once, too long ago to repeat
      'REJECTED'     -- reviewed and refused
    );
  end if;
end $$;

-- How long a vendor's confirmation of a recurring pattern stands before it
-- stops counting as current. Mirrors vendor_location_session_stale_after() so
-- both freshness thresholds live in SQL, are testable, and can be read by
-- anyone auditing why something disappeared.
create or replace function public.location_recurring_stale_after()
returns interval language sql immutable as $$
  select interval '60 days';
$$;

comment on function public.location_recurring_stale_after() is
  'How long a vendor-confirmed recurring pattern stays current. Past this, the '
  'row is treated as STALE: still visible to its owner, never shown to a '
  'customer as somewhere a vendor is.';

-- ---------------------------------------------------------------------------
-- A. Vendor recurring locations
-- ---------------------------------------------------------------------------

create table if not exists public.vendor_recurring_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vendor_unit_id uuid not null references public.vendor_units (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  public_label text not null default '',
  -- Stored per row, not per organization: one operator may work a weekday
  -- pitch in one timezone and a weekend market in another.
  timezone text not null,
  -- ISO-ish 0=Sunday … 6=Saturday, matching Postgres `extract(dow)`.
  days_of_week smallint[] not null,
  start_time time not null,
  end_time time not null,
  effective_from date,
  effective_to date,
  is_active boolean not null default true,
  last_confirmed_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_recurring_latitude_range check (latitude between -90 and 90),
  constraint vendor_recurring_longitude_range check (longitude between -180 and 180),
  constraint vendor_recurring_label_length check (char_length(public_label) <= 140),
  -- Timezone validity is enforced by a trigger below, not a CHECK: a check
  -- constraint cannot contain a subquery, and the trigger does something
  -- stricter anyway — it resolves the zone the same way the read path will.
  constraint vendor_recurring_days_present check (
    array_length(days_of_week, 1) between 1 and 7
  ),
  constraint vendor_recurring_days_range check (
    days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  -- Equal times would describe a zero-length window; overnight windows are a
  -- separate feature, not an accident of ordering.
  constraint vendor_recurring_times_ordered check (end_time > start_time),
  constraint vendor_recurring_effective_ordered check (
    effective_to is null or effective_from is null or effective_to >= effective_from
  )
);

comment on table public.vendor_recurring_locations is
  'A vendor-confirmed repeating pattern ("weekdays 11-3 at this corner"). '
  'Evaluated in the row''s own timezone at read time — never a stored '
  '"open now" flag, which would go wrong the moment nobody updated it.';

-- Resolve the zone rather than compare it to a list: this fails on exactly the
-- values that would later fail at read time, which is the property that
-- matters. A typo'd zone would otherwise shift a vendor's entire week
-- silently, and only for customers.
create or replace function public.vendor_recurring_validate_timezone()
returns trigger language plpgsql as $$
begin
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception 'unknown timezone: %', new.timezone using errcode = 'P0001';
  end;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists vendor_recurring_validate_timezone_trg
  on public.vendor_recurring_locations;
create trigger vendor_recurring_validate_timezone_trg
  before insert or update on public.vendor_recurring_locations
  for each row execute function public.vendor_recurring_validate_timezone();

create index if not exists vendor_recurring_unit_idx
  on public.vendor_recurring_locations (vendor_unit_id) where is_active;
create index if not exists vendor_recurring_org_idx
  on public.vendor_recurring_locations (organization_id);

-- One live pattern per unit per place per window: re-adding the same thing
-- should be an edit, not a duplicate pin.
create unique index if not exists vendor_recurring_no_duplicate_window
  on public.vendor_recurring_locations (
    vendor_unit_id, latitude, longitude, start_time, end_time
  ) where is_active;

alter table public.vendor_recurring_locations enable row level security;

drop policy if exists "vendor_recurring_select_member" on public.vendor_recurring_locations;
create policy "vendor_recurring_select_member"
  on public.vendor_recurring_locations for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());

drop policy if exists "vendor_recurring_write_member" on public.vendor_recurring_locations;
create policy "vendor_recurring_write_member"
  on public.vendor_recurring_locations for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and created_by = (select auth.uid())
    -- The unit must belong to the organization being claimed, so a member of
    -- one org cannot attach a schedule to another org's cart.
    and exists (
      select 1 from public.vendor_units u
       where u.id = vendor_unit_id and u.organization_id = organization_id
    )
  );

drop policy if exists "vendor_recurring_update_member" on public.vendor_recurring_locations;
create policy "vendor_recurring_update_member"
  on public.vendor_recurring_locations for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- B. Scheduled occurrences
-- ---------------------------------------------------------------------------

create table if not exists public.vendor_scheduled_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  -- Nullable: an organizer may post a market slot before any vendor is
  -- attached to it. Such a row is an event, not a vendor appearance.
  vendor_unit_id uuid references public.vendor_units (id) on delete set null,
  organizer_name text,
  event_name text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  public_label text not null default '',
  status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled', 'completed')),
  source_type public.location_source_type not null default 'VENDOR_SCHEDULED',
  source_url text,
  source_record_id text,
  verification public.location_verification not null default 'UNVERIFIED',
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_scheduled_latitude_range check (latitude between -90 and 90),
  constraint vendor_scheduled_longitude_range check (longitude between -180 and 180),
  constraint vendor_scheduled_label_length check (char_length(public_label) <= 140),
  constraint vendor_scheduled_times_ordered check (ends_at > starts_at),
  -- A vendor-owned occurrence must name its organization; an organizer-sourced
  -- one must name the organizer. Neither may be anonymous.
  constraint vendor_scheduled_has_owner check (
    organization_id is not null or nullif(trim(coalesce(organizer_name, '')), '') is not null
  )
);

comment on table public.vendor_scheduled_occurrences is
  'A specific date/time/place appearance. Vendor-created rows are CONFIRMED on '
  'save; imported ones stay UNVERIFIED until a human reviews them, so a feed '
  'can never put a vendor somewhere they did not agree to be.';

create index if not exists vendor_scheduled_window_idx
  on public.vendor_scheduled_occurrences (starts_at, ends_at) where status = 'scheduled';
create index if not exists vendor_scheduled_unit_idx
  on public.vendor_scheduled_occurrences (vendor_unit_id);

-- Re-importing the same upstream record updates it instead of duplicating.
create unique index if not exists vendor_scheduled_source_record_key
  on public.vendor_scheduled_occurrences (source_type, source_record_id)
  where source_record_id is not null;

alter table public.vendor_scheduled_occurrences enable row level security;

drop policy if exists "vendor_scheduled_select_member" on public.vendor_scheduled_occurrences;
create policy "vendor_scheduled_select_member"
  on public.vendor_scheduled_occurrences for select to authenticated
  using (
    (organization_id is not null and public.is_org_member(organization_id))
    or public.is_platform_admin()
  );

drop policy if exists "vendor_scheduled_insert_member" on public.vendor_scheduled_occurrences;
create policy "vendor_scheduled_insert_member"
  on public.vendor_scheduled_occurrences for insert to authenticated
  with check (
    organization_id is not null
    and public.is_org_member(organization_id)
    and created_by = (select auth.uid())
    and (
      vendor_unit_id is null
      or exists (
        select 1 from public.vendor_units u
         where u.id = vendor_unit_id and u.organization_id = organization_id
      )
    )
  );

drop policy if exists "vendor_scheduled_update_member" on public.vendor_scheduled_occurrences;
create policy "vendor_scheduled_update_member"
  on public.vendor_scheduled_occurrences for update to authenticated
  using (organization_id is not null and public.is_org_member(organization_id))
  with check (organization_id is not null and public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- C. Hotspots
-- ---------------------------------------------------------------------------

create table if not exists public.location_hotspots (
  id uuid primary key default gen_random_uuid(),
  latitude double precision not null,
  longitude double precision not null,
  -- Optional polygon, stored verbatim from the source. Nothing queries it;
  -- ranking uses the centroid above. Kept so provenance survives and a future
  -- PostGIS upgrade has the original geometry to work from.
  boundary jsonb,
  public_name text not null,
  source_type public.location_source_type not null,
  source_url text,
  source_record_id text,
  valid_from date,
  valid_until date,
  last_imported_at timestamptz,
  verification public.location_verification not null default 'UNVERIFIED',
  -- Reviewer-only. Never selected by any public view.
  review_notes text,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_hotspots_latitude_range check (latitude between -90 and 90),
  constraint location_hotspots_longitude_range check (longitude between -180 and 180),
  constraint location_hotspots_name_length check (char_length(public_name) between 1 and 140),
  constraint location_hotspots_valid_ordered check (
    valid_until is null or valid_from is null or valid_until >= valid_from
  ),
  -- A hotspot describes a place, never a vendor. There is deliberately no
  -- vendor_unit_id column: association is a reviewer action that creates a
  -- separate vendor-owned row, so an import can never claim a vendor.
  constraint location_hotspots_source_is_not_vendor check (
    source_type <> 'VENDOR_LIVE'
  )
);

comment on table public.location_hotspots is
  'Places where mobile food vendors commonly operate, per a dataset or '
  'directory. Carries no vendor association by design — presence here is '
  'never evidence that any vendor is there.';

-- The single index that makes re-import idempotent.
create unique index if not exists location_hotspots_source_record_key
  on public.location_hotspots (source_type, source_record_id)
  where source_record_id is not null;

alter table public.location_hotspots enable row level security;

-- Only platform admins touch hotspots directly; customers read the public view
-- below, which exposes approved rows and no reviewer fields.
drop policy if exists "location_hotspots_admin" on public.location_hotspots;
create policy "location_hotspots_admin"
  on public.location_hotspots for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- D. Community reports (staged only)
-- ---------------------------------------------------------------------------

create table if not exists public.location_reports (
  id uuid primary key default gen_random_uuid(),
  reported_by uuid references auth.users (id) on delete set null,
  latitude double precision not null,
  longitude double precision not null,
  note text,
  vendor_unit_id uuid references public.vendor_units (id) on delete set null,
  source_type public.location_source_type not null default 'COMMUNITY_REPORT',
  verification public.location_verification not null default 'UNVERIFIED',
  review_notes text,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint location_reports_latitude_range check (latitude between -90 and 90),
  constraint location_reports_longitude_range check (longitude between -180 and 180),
  constraint location_reports_note_length check (note is null or char_length(note) <= 500)
);

comment on table public.location_reports is
  'Customer sightings. A staging table with no read path to discovery: a '
  'report can never move a vendor''s pin. Reporter identity is never exposed '
  'to anyone but a platform admin.';

alter table public.location_reports enable row level security;

drop policy if exists "location_reports_admin" on public.location_reports;
create policy "location_reports_admin"
  on public.location_reports for select to authenticated
  using (public.is_platform_admin());

drop policy if exists "location_reports_insert_own" on public.location_reports;
create policy "location_reports_insert_own"
  on public.location_reports for insert to authenticated
  with check (reported_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Public views — the only surface anon/customers read
-- ---------------------------------------------------------------------------

drop view if exists public.vendor_recurring_location_previews;
create view public.vendor_recurring_location_previews as
select
  r.id,
  r.vendor_unit_id,
  r.organization_id,
  o.slug as organization_slug,
  u.slug as unit_slug,
  r.latitude,
  r.longitude,
  r.public_label,
  r.timezone,
  r.days_of_week,
  r.start_time,
  r.end_time,
  r.last_confirmed_at,
  -- Freshness decided here, once, so no caller can forget it.
  (r.last_confirmed_at > now() - public.location_recurring_stale_after()) as is_current
from public.vendor_recurring_locations r
join public.vendor_units u on u.id = r.vendor_unit_id
join public.organizations o on o.id = r.organization_id
where o.status = 'active'
  and r.is_active
  and (r.effective_from is null or r.effective_from <= current_date)
  and (r.effective_to is null or r.effective_to >= current_date);

comment on view public.vendor_recurring_location_previews is
  'Public projection of active recurring patterns. `is_current` carries the '
  'confirmation-freshness rule so ranking never has to restate it.';

drop view if exists public.vendor_scheduled_occurrence_previews;
create view public.vendor_scheduled_occurrence_previews as
select
  s.id,
  s.vendor_unit_id,
  s.organization_id,
  o.slug as organization_slug,
  u.slug as unit_slug,
  s.organizer_name,
  s.event_name,
  s.starts_at,
  s.ends_at,
  s.latitude,
  s.longitude,
  s.public_label,
  s.source_type,
  s.source_url,
  s.verification,
  s.confirmed_at
from public.vendor_scheduled_occurrences s
left join public.vendor_units u on u.id = s.vendor_unit_id
left join public.organizations o on o.id = s.organization_id
where s.status = 'scheduled'
  and (o.id is null or o.status = 'active')
  -- Unreviewed imports stay out of customer-facing results entirely.
  and s.verification in ('CONFIRMED', 'EXPECTED');

comment on view public.vendor_scheduled_occurrence_previews is
  'Public projection of scheduled appearances. UNVERIFIED rows — every '
  'unreviewed import and social lead — are excluded, so no feed can place a '
  'vendor anywhere without a human having agreed.';

drop view if exists public.location_hotspot_previews;
create view public.location_hotspot_previews as
select
  h.id,
  h.latitude,
  h.longitude,
  h.public_name,
  h.source_type,
  h.source_url,
  h.valid_from,
  h.valid_until,
  h.last_imported_at
  -- review_notes / reviewed_by deliberately absent.
from public.location_hotspots h
where h.verification = 'CONFIRMED'
  and (h.valid_from is null or h.valid_from <= current_date)
  and (h.valid_until is null or h.valid_until >= current_date);

comment on view public.location_hotspot_previews is
  'Approved hotspots only, with reviewer notes and reviewer identity omitted. '
  'A row here is a place, not a vendor.';

grant select on public.vendor_recurring_location_previews to anon, authenticated;
grant select on public.vendor_scheduled_occurrence_previews to anon, authenticated;
grant select on public.location_hotspot_previews to anon, authenticated;

grant select, insert, update on public.vendor_recurring_locations to authenticated;
grant select, insert, update on public.vendor_scheduled_occurrences to authenticated;
grant select on public.location_hotspots to authenticated;
grant select, insert on public.location_reports to authenticated;
