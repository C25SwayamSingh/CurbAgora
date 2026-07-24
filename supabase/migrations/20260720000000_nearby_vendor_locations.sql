-- ============================================================================
-- nearby_vendor_locations — one ranked answer across all four location states
-- ============================================================================
-- Sits BESIDE nearby_live_vendors rather than replacing it: live discovery
-- keeps working, with its existing tests, while this surface is built out.
--
-- Two rules carry the design:
--
--   1. LIVE OVERRIDES. A vendor standing somewhere beats every prediction
--      about where they would be. A unit with a live session is emitted once,
--      as live; its recurring and scheduled rows are suppressed rather than
--      listed alongside, so a customer never sees one cart as two pins
--      disagreeing with each other.
--
--   2. A HOTSPOT IS NOT A VENDOR. Hotspots carry no vendor_unit_id, rank last,
--      and their label says so in words. Nothing in this function can promote
--      one into a vendor result.
--
-- `reason_label` is composed here, in SQL, so the map pin and the list row
-- cannot drift apart — they read the same string. Ranking is an explicit
-- integer, not an opaque score: 1 live, 2 happening-now scheduled, 3 matching
-- recurring, 4 upcoming scheduled, 5 hotspot.
--
-- Reads only the public preview views, inheriting active-organization
-- filtering, confirmation freshness, and the exclusion of unreviewed imports.
-- The caller's coordinates are arguments, used once, never stored.
-- ============================================================================

create or replace function public.nearby_vendor_locations(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_miles double precision,
  p_include_live boolean default true,
  p_include_scheduled boolean default true,
  p_include_recurring boolean default true,
  p_include_hotspots boolean default false
) returns table (
  result_id text,
  state text,
  rank int,
  vendor_unit_id uuid,
  organization_slug text,
  unit_slug text,
  name text,
  unit_type public.vendor_unit_type,
  cuisine_categories text[],
  primary_image_path text,
  latitude double precision,
  longitude double precision,
  public_label text,
  reason_label text,
  source_type public.location_source_type,
  verification public.location_verification,
  last_verified_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  distance_miles double precision
)
language plpgsql
stable
as $$
begin
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then
    raise exception 'latitude out of range' using errcode = '22023';
  end if;
  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'longitude out of range' using errcode = '22023';
  end if;
  if p_radius_miles is null or p_radius_miles <= 0 or p_radius_miles > 25 then
    raise exception 'radius out of range' using errcode = '22023';
  end if;

  return query
  with candidates as (
    -- 1. LIVE ------------------------------------------------------------
    select
      'live:' || s.id::text as result_id,
      'LIVE' as state,
      1 as rank,
      s.vendor_unit_id,
      s.organization_slug,
      s.unit_slug,
      s.latitude,
      s.longitude,
      s.public_label,
      -- Relative time rather than a clock reading: "4 minutes ago" answers
      -- "should I trust this", which is the actual question.
      'Live — confirmed ' || public.location_relative_minutes(s.started_at) as reason_label,
      'VENDOR_LIVE'::public.location_source_type as source_type,
      'CONFIRMED'::public.location_verification as verification,
      s.started_at as last_verified_at,
      -- Aliased: a UNION takes its column names from the first branch, and an
      -- unaliased `started_at` here would name the shared column wrongly for
      -- every later branch.
      s.started_at as starts_at,
      s.expected_end_at as ends_at
    from public.vendor_location_session_previews s
    where p_include_live

    union all

    -- 2. SCHEDULED, happening now ----------------------------------------
    select
      'sched:' || o.id::text,
      'SCHEDULED_NOW',
      2,
      o.vendor_unit_id,
      o.organization_slug,
      o.unit_slug,
      o.latitude,
      o.longitude,
      o.public_label,
      'Scheduled now, until ' || to_char(o.ends_at, 'FMHH12:MI AM'),
      o.source_type,
      o.verification,
      coalesce(o.confirmed_at, o.starts_at),
      o.starts_at,
      o.ends_at
    from public.vendor_scheduled_occurrence_previews o
    where p_include_scheduled
      and now() between o.starts_at and o.ends_at

    union all

    -- 3. RECURRING, matching right now in ITS OWN timezone ----------------
    -- The whole point of storing a timezone per row: "weekdays 11-3" means
    -- 11-3 where the cart is, not where the server is.
    select
      'recur:' || r.id::text,
      'RECURRING_NOW',
      3,
      r.vendor_unit_id,
      r.organization_slug,
      r.unit_slug,
      r.latitude,
      r.longitude,
      r.public_label,
      'Usually here ' || public.location_days_phrase(r.days_of_week)
        || ', ' || to_char(r.start_time, 'FMHH12 AM')
        || '–' || to_char(r.end_time, 'FMHH12 AM'),
      'VENDOR_RECURRING'::public.location_source_type,
      'EXPECTED'::public.location_verification,
      r.last_confirmed_at,
      null::timestamptz,
      null::timestamptz
    from public.vendor_recurring_location_previews r
    where p_include_recurring
      -- STALE patterns are excluded outright. A vendor who has not reconfirmed
      -- in 60 days is not a claim worth sending someone across town on.
      and r.is_current
      and extract(dow from (now() at time zone r.timezone))::smallint = any(r.days_of_week)
      and (now() at time zone r.timezone)::time between r.start_time and r.end_time

    union all

    -- 4. SCHEDULED, upcoming within 24h ----------------------------------
    select
      'soon:' || o.id::text,
      'SCHEDULED_UPCOMING',
      4,
      o.vendor_unit_id,
      o.organization_slug,
      o.unit_slug,
      o.latitude,
      o.longitude,
      o.public_label,
      'Scheduled ' || public.location_when_phrase(o.starts_at)
        || ', ' || to_char(o.starts_at, 'FMHH12:MI AM')
        || '–' || to_char(o.ends_at, 'FMHH12:MI AM'),
      o.source_type,
      o.verification,
      coalesce(o.confirmed_at, o.starts_at),
      o.starts_at,
      o.ends_at
    from public.vendor_scheduled_occurrence_previews o
    where p_include_scheduled
      and o.starts_at > now()
      and o.starts_at <= now() + interval '24 hours'

    union all

    -- 5. HOTSPOT ----------------------------------------------------------
    -- No vendor_unit_id, and the label says outright that nobody is confirmed.
    select
      'spot:' || h.id::text,
      'HOTSPOT',
      5,
      null::uuid,
      null::text,
      null::text,
      h.latitude,
      h.longitude,
      h.public_name,
      'Food-vendor hotspot — vendor not confirmed',
      h.source_type,
      'CONFIRMED'::public.location_verification,
      h.last_imported_at,
      null::timestamptz,
      null::timestamptz
    from public.location_hotspot_previews h
    where p_include_hotspots
  ),
  measured as (
    select
      c.*,
      d.miles
    from candidates c
    cross join lateral (
      select 2 * 3958.8 * asin(
        sqrt(
          power(sin(radians(c.latitude - p_latitude) / 2), 2)
          + cos(radians(p_latitude)) * cos(radians(c.latitude))
            * power(sin(radians(c.longitude - p_longitude) / 2), 2)
        )
      ) as miles
    ) d
    where d.miles <= p_radius_miles
  ),
  -- LIVE OVERRIDES: one row per vendor unit, keeping the best-ranked state.
  -- Hotspots have a null unit and must all survive, so they are partitioned
  -- by their own id instead.
  best_per_unit as (
    select distinct on (coalesce(m.vendor_unit_id::text, m.result_id))
      m.*
    from measured m
    order by coalesce(m.vendor_unit_id::text, m.result_id), m.rank asc, m.miles asc
  ),
  -- Proximity dedupe: a hotspot and the vendor parked on it are one place.
  -- Requires BOTH ~40m proximity and a matching label, so two genuinely
  -- different carts at one busy corner are not silently merged into one.
  deduped as (
    select distinct on (
      round(b.latitude::numeric, 4),
      round(b.longitude::numeric, 4),
      lower(trim(b.public_label))
    ) b.*
    from best_per_unit b
    order by
      round(b.latitude::numeric, 4),
      round(b.longitude::numeric, 4),
      lower(trim(b.public_label)),
      b.rank asc
  )
  select
    d.result_id,
    d.state,
    d.rank,
    d.vendor_unit_id,
    d.organization_slug,
    d.unit_slug,
    u.name,
    u.unit_type,
    u.cuisine_categories,
    u.primary_image_path,
    d.latitude,
    d.longitude,
    d.public_label,
    d.reason_label,
    d.source_type,
    d.verification,
    d.last_verified_at,
    d.starts_at,
    d.ends_at,
    d.miles as distance_miles
  from deduped d
  left join public.vendor_unit_previews u on u.id = d.vendor_unit_id
  order by d.rank asc, d.miles asc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Label helpers — small, immutable, and testable on their own
-- ---------------------------------------------------------------------------

create or replace function public.location_relative_minutes(p_since timestamptz)
returns text language sql stable as $$
  select case
    when p_since is null then 'recently'
    when now() - p_since < interval '2 minutes' then 'just now'
    when now() - p_since < interval '1 hour'
      then extract(epoch from (now() - p_since))::int / 60 || ' minutes ago'
    when now() - p_since < interval '2 hours' then 'an hour ago'
    else extract(epoch from (now() - p_since))::int / 3600 || ' hours ago'
  end;
$$;

/**
 * "weekdays" / "weekends" / "Tue & Thu" — the shape an owner would say aloud,
 * rather than a list of day numbers.
 */
create or replace function public.location_days_phrase(p_days smallint[])
returns text language sql immutable as $$
  select case
    when p_days @> array[1,2,3,4,5]::smallint[]
      and not (p_days && array[0,6]::smallint[]) then 'weekdays'
    when p_days @> array[0,6]::smallint[]
      and not (p_days && array[1,2,3,4,5]::smallint[]) then 'weekends'
    when array_length(p_days, 1) = 7 then 'every day'
    else (
      select string_agg(
        case d
          when 0 then 'Sun' when 1 then 'Mon' when 2 then 'Tue' when 3 then 'Wed'
          when 4 then 'Thu' when 5 then 'Fri' else 'Sat'
        end, ' & ' order by d)
      from unnest(p_days) as d
    )
  end;
$$;

create or replace function public.location_when_phrase(p_at timestamptz)
returns text language sql stable as $$
  select case
    when p_at::date = current_date then 'today'
    when p_at::date = current_date + 1 then 'tomorrow'
    else to_char(p_at, 'FMDay')
  end;
$$;

comment on function public.nearby_vendor_locations(
  double precision, double precision, double precision,
  boolean, boolean, boolean, boolean) is
  'Ranked discovery across all four location states. Live outranks every '
  'prediction for the same unit; hotspots rank last, carry no vendor, and say '
  'so in their label. Reads only public views; never stores the caller''s '
  'coordinates.';

grant execute on function public.nearby_vendor_locations(
  double precision, double precision, double precision,
  boolean, boolean, boolean, boolean) to anon, authenticated;
grant execute on function public.location_relative_minutes(timestamptz) to anon, authenticated;
grant execute on function public.location_days_phrase(smallint[]) to anon, authenticated;
grant execute on function public.location_when_phrase(timestamptz) to anon, authenticated;
