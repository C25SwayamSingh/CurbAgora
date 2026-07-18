-- ============================================================================
-- Customer nearby-vendor discovery: nearby_live_vendors(lat, lng, radius).
--
-- One SQL entry point for "which vendors are live near this point right
-- now". Distance math happens here in PostgreSQL — the client never
-- downloads the full vendor table to filter it locally.
--
-- Privacy/security properties:
--   * Reads ONLY through the two public views (vendor_unit_previews,
--     vendor_location_session_previews), so every existing rule — active
--     organizations only, live non-stale non-ended sessions only, contact
--     masking — is inherited rather than re-implemented. No base-table
--     access is added for anon.
--   * The customer's coordinates are function ARGUMENTS: used for the
--     one query and never written anywhere.
--   * Inputs are validated here (not just in the app layer): out-of-range
--     coordinates or a non-positive/excessive radius raise an exception,
--     so a hand-crafted PostgREST rpc call can't request a continent-wide
--     scan.
--
-- Distance: haversine great-circle miles over plain double-precision
-- lat/lng — same columns a future PostGIS geography index would cover.
-- If vendor counts ever make this slow, the documented upgrade path in
-- 20260710000000_vendor_location_sessions.sql (PostGIS + ST_DWithin) can
-- replace the formula without changing this function's signature.
-- ============================================================================

create or replace function public.nearby_live_vendors(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_miles double precision
) returns table (
  vendor_unit_id uuid,
  organization_id uuid,
  organization_slug text,
  unit_slug text,
  name text,
  unit_type public.vendor_unit_type,
  cuisine_categories text[],
  city text,
  state text,
  neighborhood text,
  primary_image_path text,
  operating_status public.vendor_operating_status,
  latitude double precision,
  longitude double precision,
  public_label text,
  started_at timestamptz,
  expected_end_at timestamptz,
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
  select
    s.vendor_unit_id,
    s.organization_id,
    s.organization_slug,
    s.unit_slug,
    u.name,
    u.unit_type,
    u.cuisine_categories,
    u.city,
    u.state,
    u.neighborhood,
    u.primary_image_path,
    u.operating_status,
    s.latitude,
    s.longitude,
    s.public_label,
    s.started_at,
    s.expected_end_at,
    d.miles as distance_miles
  from public.vendor_location_session_previews s
  join public.vendor_unit_previews u on u.id = s.vendor_unit_id
  cross join lateral (
    -- Haversine great-circle distance in miles (earth radius 3958.8 mi).
    select 2 * 3958.8 * asin(
      sqrt(
        power(sin(radians(s.latitude - p_latitude) / 2), 2)
        + cos(radians(p_latitude)) * cos(radians(s.latitude))
          * power(sin(radians(s.longitude - p_longitude) / 2), 2)
      )
    ) as miles
  ) d
  where d.miles <= p_radius_miles
  order by d.miles asc;
end;
$$;

comment on function public.nearby_live_vendors(double precision, double precision, double precision) is
  'Public discovery query: live (non-ended, non-stale, active-org) vendor '
  'sessions within p_radius_miles of a point, nearest first. Reads only '
  'the public preview views, validates all inputs (raising 22023 on '
  'out-of-range coordinates or radius), and never stores the caller''s '
  'coordinates.';

grant execute on function public.nearby_live_vendors(double precision, double precision, double precision)
  to anon, authenticated;
