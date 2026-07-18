-- pgTAP adversarial tests for vendor_location_sessions: any active member
-- (owner/manager/staff) can start/update/end a "go live" session, a
-- cross-org vendor_unit_id/organization_id mismatch is rejected, at most
-- one open session exists per unit, base-table visibility is member-only
-- and organization-isolated, and the public view exposes only currently
-- live (not ended, not stale, active-org) sessions.
-- Run with: supabase test db   (see supabase/tests/README.md)
--
-- Covers: supabase/migrations/20260710000000_vendor_location_sessions.sql
--
-- Self-contained: each pgTAP test file is wrapped in its own transaction
-- and rolled back, so the helper functions from 001_rls_policies.sql do
-- not persist here — they are redefined below, identically.
begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

-- ----------------------------------------------------------------------------
-- Fixtures: owner + manager + staff of "taco-cart" (manager also belongs
-- to "burger-truck", to exercise legitimate cross-org membership), a
-- stranger with no membership anywhere, and one vendor_units row per org
-- to attach sessions to.
-- ----------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local',    'x', now(), '{"provider":"email"}', '{"display_name":"Owner"}'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@test.local',  'x', now(), '{"provider":"email"}', '{"display_name":"Manager"}'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@test.local',    'x', now(), '{"provider":"email"}', '{"display_name":"Staff"}'),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@test.local',    'x', now(), '{"provider":"email"}', '{"display_name":"Other Owner"}'),
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

create or replace function test_rows_updated(update_sql text) returns int language plpgsql as $$
declare row_count int;
begin
  execute format(
    'with updated as (%s returning 1) select count(*)::int from updated',
    update_sql
  ) into row_count;
  return row_count;
end;
$$;

select test_as_service();

insert into public.organizations (id, legal_name, display_name, slug, created_by)
values
  ('10000000-0000-0000-0000-000000000001', 'Taco Cart LLC', 'Taco Cart', 'taco-cart', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', 'Burger Truck LLC', 'Burger Truck', 'burger-truck', '00000000-0000-0000-0000-000000000004');

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'manager', 'active'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'staff', 'active'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'owner', 'active'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'manager', 'active');

insert into public.vendor_units (id, organization_id, name, slug, unit_type, city, state, created_by)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Taco Cart', 'taco-cart', 'food_truck', 'Austin', 'TX', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Burger Truck', 'burger-truck', 'food_truck', 'Dallas', 'TX', '00000000-0000-0000-0000-000000000004');

-- ----------------------------------------------------------------------------
-- Starting a session: cross-org mismatch and duplicate-open rejected
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000001', 'aal1');

select lives_ok(
  $$ insert into public.vendor_location_sessions
       (id, vendor_unit_id, organization_id, latitude, longitude, public_label, created_by)
     values
       ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001', 30.2672, -97.7431, 'Corner of 5th & Main',
        '00000000-0000-0000-0000-000000000001') $$,
  'AAL1 owner can start a location session for their own unit'
);

select throws_ok(
  $$ insert into public.vendor_location_sessions
       (vendor_unit_id, organization_id, latitude, longitude, public_label, created_by)
     values
       ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
        30.0, -97.0, 'Cross-org spoof attempt', '00000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'submitting a vendor_unit_id belonging to a DIFFERENT org than organization_id is rejected'
);

select throws_ok(
  $$ insert into public.vendor_location_sessions
       (vendor_unit_id, organization_id, latitude, longitude, public_label, created_by)
     values
       ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        30.3, -97.8, 'Second session while one is open', '00000000-0000-0000-0000-000000000001') $$,
  '23505',
  null,
  'a unit can have at most one OPEN session at a time'
);

select test_as_anon();

select throws_ok(
  $$ insert into public.vendor_location_sessions
       (vendor_unit_id, organization_id, latitude, longitude, public_label, created_by)
     values
       ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        30.0, -97.0, 'Anon attempt', '00000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'anon cannot start a location session'
);

select test_as_user('00000000-0000-0000-0000-000000000005', 'aal1');

select throws_ok(
  $$ insert into public.vendor_location_sessions
       (vendor_unit_id, organization_id, latitude, longitude, public_label, created_by)
     values
       ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        30.0, -97.0, 'Stranger attempt', '00000000-0000-0000-0000-000000000005') $$,
  '42501',
  null,
  'a stranger with no membership cannot start a location session'
);

-- ----------------------------------------------------------------------------
-- Updating and ending — any active member, cross-org blocked
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000002', 'aal1');

select is(
  test_rows_updated(
    $$ update public.vendor_location_sessions
       set public_label = 'Moved a block over', last_confirmed_at = now()
       where id = '30000000-0000-0000-0000-000000000001' $$),
  1,
  'a manager can update a session belonging to an organization they manage'
);

select test_as_user('00000000-0000-0000-0000-000000000004', 'aal1');

select is(
  test_rows_updated(
    $$ update public.vendor_location_sessions
       set public_label = 'Cross-org tampering attempt'
       where id = '30000000-0000-0000-0000-000000000001' $$),
  0,
  'an owner of one organization cannot update another organization''s session'
);

select test_as_user('00000000-0000-0000-0000-000000000003', 'aal1');

select is(
  test_rows_updated(
    $$ update public.vendor_location_sessions
       set ended_at = now()
       where id = '30000000-0000-0000-0000-000000000001' $$),
  1,
  'staff can end a session belonging to their own organization — operational, not owner/manager-only like vendor_units CRUD'
);

-- Now that taco-cart's unit has no open session, staff starting a new one
-- for the SAME unit must succeed (the partial unique index only blocks a
-- second OPEN session, and staff is a permitted writer).
select lives_ok(
  $$ insert into public.vendor_location_sessions
       (id, vendor_unit_id, organization_id, latitude, longitude, public_label, created_by)
     values
       ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001', 30.27, -97.75, 'Back on 6th Street',
        '00000000-0000-0000-0000-000000000003') $$,
  'staff can start a new session once the unit''s previous open session has been ended'
);

-- The cross-org manager starts burger-truck's session.
select test_as_user('00000000-0000-0000-0000-000000000002', 'aal1');

select lives_ok(
  $$ insert into public.vendor_location_sessions
       (id, vendor_unit_id, organization_id, latitude, longitude, public_label, created_by)
     values
       ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002',
        '10000000-0000-0000-0000-000000000002', 32.7767, -96.7970, 'By the fountain',
        '00000000-0000-0000-0000-000000000002') $$,
  'a member of both organizations can start a session for the org they''re acting as'
);

-- ----------------------------------------------------------------------------
-- Viewing the base table: member-only, organization-isolated, includes
-- ended sessions (an org's own history), not just currently-live ones.
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000001', 'aal1');

select is(
  (select count(*)::int from public.vendor_location_sessions),
  2,
  'owner sees their organization''s full session history (ended + open), not other orgs'''
);

select test_as_user('00000000-0000-0000-0000-000000000005', 'aal1');

select is(
  (select count(*)::int from public.vendor_location_sessions),
  0,
  'a stranger sees no sessions via the base table'
);

select test_as_anon();

select is(
  (select count(*)::int from public.vendor_location_sessions),
  0,
  'anon reads no rows from the base table directly (RLS default deny)'
);

-- ----------------------------------------------------------------------------
-- Public view: only currently-live sessions (not ended, not stale, active org)
-- ----------------------------------------------------------------------------

-- Scoped to this file's own fixture organizations — the public view has
-- no membership filtering, so an unscoped count(*) also picks up any
-- live sessions left over from manual testing in this database and
-- fails nondeterministically.
select is(
  (select count(*)::int from public.vendor_location_session_previews
    where organization_id in (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002')),
  2,
  'anon sees both currently-open, fresh sessions through the public view (the ended taco-cart session does not appear)'
);

select is(
  (select public_label from public.vendor_location_session_previews
    where organization_slug = 'taco-cart' and unit_slug = 'taco-cart'),
  'Back on 6th Street',
  'the public view shows the unit''s current open session, not its ended history'
);

select test_as_service();

-- Simulate staleness: shift the whole session's timeline into the past
-- (started_at AND last_confirmed_at together) so last_confirmed_at is
-- well past the staleness window without ending the session or violating
-- the last_confirmed_at >= started_at check (back-dating last_confirmed_at
-- alone, with started_at left at "now", would itself be rejected — that
-- invariant is real: the app only ever moves last_confirmed_at forward).
update public.vendor_location_sessions
set started_at = now() - interval '2 hours',
    last_confirmed_at = now() - interval '1 hour'
where id = '30000000-0000-0000-0000-000000000003';

select test_as_anon();

select is(
  (select count(*)::int from public.vendor_location_session_previews
    where organization_slug = 'burger-truck'),
  0,
  'a stale (not recently confirmed) session is excluded from the public view even though it was never manually ended'
);

select test_as_user('00000000-0000-0000-0000-000000000004', 'aal1');

select is(
  (select count(*)::int from public.vendor_location_sessions
    where organization_id = '10000000-0000-0000-0000-000000000002' and ended_at is null),
  1,
  'the stale session still exists and is still "open" from the org''s own point of view — staleness only affects public visibility'
);

select test_as_service();

update public.organizations set status = 'suspended'
where slug = 'taco-cart';

select test_as_anon();

-- Same scoping rationale as the count(*) assertion above.
select is(
  (select count(*)::int from public.vendor_location_session_previews
    where organization_id in (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002')),
  0,
  'a suspended organization''s sessions are excluded from the public view even while otherwise live'
);

select * from finish();

rollback;
