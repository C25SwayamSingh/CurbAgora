-- pgTAP tests for nearby_live_vendors(): in-radius live sessions are
-- returned nearest-first, out-of-radius / stale / ended / suspended-org
-- sessions are excluded, invalid inputs are rejected, and anonymous
-- callers get exactly the same public data as authenticated ones.
-- Run with: supabase test db   (see supabase/tests/README.md)
--
-- Covers: supabase/migrations/20260712000000_nearby_live_vendors.sql
--
-- Fixture-scoped: every count filters to this file's own fixture unit
-- ids, so real local data (manual testing) never affects results.
begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

-- ----------------------------------------------------------------------------
-- Fixtures. Search center for all queries: (40.0, -74.0).
--   unit A: live at (40.01,  -74.0)   ≈ 0.7 mi  → inside every radius
--   unit B: live at (40.2,   -74.0)   ≈ 13.8 mi → outside 10 mi, inside 25
--   unit C: OPEN but stale (last confirmed 1 h ago) at ≈ 0.5 mi
--   unit D: ended at ≈ 0.3 mi
--   unit E: live at ≈ 0.35 mi but under a SUSPENDED organization
-- ----------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local',    'x', now(), '{"provider":"email"}', '{"display_name":"Owner"}'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@test.local',    'x', now(), '{"provider":"email"}', '{"display_name":"Other Owner"}'),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger@test.local', 'x', now(), '{"provider":"email"}', '{"display_name":"Stranger"}');

create or replace function test_as_user(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
end;
$$;

create or replace function test_as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end;
$$;

create or replace function test_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select test_as_service();

insert into public.organizations (id, legal_name, display_name, slug, created_by, status)
values
  ('10000000-0000-0000-0000-000000000001', 'Taco Cart LLC', 'Taco Cart', 'taco-cart', '00000000-0000-0000-0000-000000000001', 'active'),
  ('10000000-0000-0000-0000-000000000002', 'Ghost Kitchen LLC', 'Ghost Kitchen', 'ghost-kitchen', '00000000-0000-0000-0000-000000000002', 'suspended');

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'owner', 'active');

insert into public.vendor_units (id, organization_id, name, slug, unit_type, city, state, created_by)
values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'Unit A Near', 'unit-a', 'food_cart', 'Testville', 'NJ', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'Unit B Far', 'unit-b', 'food_truck', 'Testville', 'NJ', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', 'Unit C Stale', 'unit-c', 'stand', 'Testville', 'NJ', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000001', 'Unit D Ended', 'unit-d', 'stall', 'Testville', 'NJ', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000002', 'Unit E Suspended', 'unit-e', 'pop_up', 'Testville', 'NJ', '00000000-0000-0000-0000-000000000002');

insert into public.vendor_location_sessions
  (vendor_unit_id, organization_id, latitude, longitude, public_label, started_at, last_confirmed_at, ended_at, created_by)
values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 40.01, -74.0, 'A: near corner', now(), now(), null, '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 40.2, -74.0, 'B: far lot', now(), now(), null, '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', 40.007, -74.0, 'C: stale spot', now() - interval '2 hours', now() - interval '1 hour', null, '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000001', 40.004, -74.0, 'D: ended spot', now() - interval '2 hours', now() - interval '90 minutes', now() - interval '1 hour', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000002', 40.005, -74.0, 'E: suspended org', now(), now(), null, '00000000-0000-0000-0000-000000000002');

-- Fixture-scoped helper: nearby results restricted to this file's units,
-- with just the columns the assertions below need.
create or replace function test_nearby_fixture(p_lat double precision, p_lng double precision, p_radius double precision)
returns table (vendor_unit_id uuid, name text, distance_miles double precision)
language sql stable as $$
  select n.vendor_unit_id, n.name, n.distance_miles
  from public.nearby_live_vendors(p_lat, p_lng, p_radius) n
  where n.vendor_unit_id::text like '20000000-0000-0000-0000-00000000000%'
$$;

-- ----------------------------------------------------------------------------
-- Anonymous discovery
-- ----------------------------------------------------------------------------

select test_as_anon();

select is(
  (select count(*)::int from test_nearby_fixture(40.0, -74.0, 5)),
  1,
  'within 5 miles, only the near live vendor (A) is returned — stale, ended, and suspended-org sessions are all excluded'
);

select is(
  (select name from test_nearby_fixture(40.0, -74.0, 5) limit 1),
  'Unit A Near',
  'the returned vendor is unit A with its public data'
);

select ok(
  (select distance_miles between 0.5 and 1.0 from test_nearby_fixture(40.0, -74.0, 5) limit 1),
  'distance to unit A is computed correctly (≈0.7 miles)'
);

select is(
  (select count(*)::int from test_nearby_fixture(40.0, -74.0, 25)),
  2,
  'a 25-mile radius also includes the far vendor (B), still excluding stale/ended/suspended'
);

select is(
  (select array_agg(name order by distance_miles) from test_nearby_fixture(40.0, -74.0, 25)),
  array['Unit A Near', 'Unit B Far'],
  'both live vendors appear with the near one at the smaller distance'
);

select is(
  (select count(*)::int from test_nearby_fixture(40.0, -74.0, 25) where name = 'Unit C Stale'),
  0,
  'an open but stale session (not confirmed within the staleness window) is never returned'
);

select is(
  (select count(*)::int from test_nearby_fixture(40.0, -74.0, 25) where name = 'Unit D Ended'),
  0,
  'an ended session is never returned'
);

select is(
  (select count(*)::int from test_nearby_fixture(40.0, -74.0, 25) where name = 'Unit E Suspended'),
  0,
  'a live session under a suspended organization is never returned'
);

-- ----------------------------------------------------------------------------
-- Input validation (server-side, in the database itself)
-- ----------------------------------------------------------------------------

select throws_ok(
  $$ select * from public.nearby_live_vendors(91, -74.0, 5) $$,
  '22023', null,
  'latitude beyond ±90 is rejected'
);

select throws_ok(
  $$ select * from public.nearby_live_vendors(40.0, -181, 5) $$,
  '22023', null,
  'longitude beyond ±180 is rejected'
);

select throws_ok(
  $$ select * from public.nearby_live_vendors(40.0, -74.0, 0) $$,
  '22023', null,
  'a non-positive radius is rejected'
);

select throws_ok(
  $$ select * from public.nearby_live_vendors(40.0, -74.0, 26) $$,
  '22023', null,
  'a radius beyond the 25-mile ceiling is rejected (no continent-wide scans)'
);

-- ----------------------------------------------------------------------------
-- Authenticated callers see exactly the same public data
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000005');

select is(
  (select count(*)::int from test_nearby_fixture(40.0, -74.0, 5)),
  1,
  'an authenticated stranger gets the same public results as anon (no privileged leakage path)'
);

select * from finish();
rollback;
