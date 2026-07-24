-- pgTAP tests for the four-state location layer.
--
-- The properties worth proving are the ones that would embarrass the product
-- if they broke: a hotspot appearing as a vendor, a stale pattern reading as
-- "open", a recurring window matching the server's day instead of the cart's,
-- and an imported feed placing a vendor somewhere they never agreed to be.
--
-- Covers: supabase/migrations/20260719000000_location_intelligence.sql
--         supabase/migrations/20260720000000_nearby_vendor_locations.sql
--
-- Fixture-scoped and time-relative: every window is expressed against now(),
-- so the file does not rot on a particular date.
begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@loc.test',   'x', now(), '{"provider":"email"}', '{"display_name":"Owner"}'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@loc.test',   'x', now(), '{"provider":"email"}', '{"display_name":"Other"}'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@loc.test',   'x', now(), '{"provider":"email"}', '{"display_name":"Admin"}');

create or replace function test_as_user(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
end;
$$;

create or replace function test_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select test_as_service();

insert into public.organizations (id, legal_name, display_name, slug, created_by)
values
  ('30000000-0000-0000-0000-000000000001', 'Loc Cart LLC',  'Loc Cart',  'loc-cart',  '00000000-0000-0000-0000-0000000000c1'),
  ('30000000-0000-0000-0000-000000000002', 'Rival Cart LLC','Rival Cart','rival-cart','00000000-0000-0000-0000-0000000000c2');

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'owner', 'active'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2', 'owner', 'active');

insert into public.vendor_units (id, organization_id, name, slug, unit_type, city, state, created_by)
values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   'Loc Cart', 'loc-cart', 'food_cart', 'Testville', 'NJ', '00000000-0000-0000-0000-0000000000c1'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002',
   'Rival Cart', 'rival-cart', 'food_cart', 'Testville', 'NJ', '00000000-0000-0000-0000-0000000000c2');

-- Search origin used by every ranking assertion below.
-- 40.7000, -74.0000. All fixtures sit within a mile of it.

-- ----------------------------------------------------------------------------
-- Timezone correctness — the likeliest source of silent wrongness
-- ----------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.vendor_recurring_locations
       (organization_id, vendor_unit_id, latitude, longitude, timezone,
        days_of_week, start_time, end_time, created_by)
     values ('30000000-0000-0000-0000-000000000001',
             '40000000-0000-0000-0000-000000000001', 40.70, -74.00,
             'Not/ARealZone', array[1]::smallint[], '11:00', '15:00',
             '00000000-0000-0000-0000-0000000000c1') $$,
  'P0001', NULL,
  'A misspelled timezone is refused at write time, not discovered by customers'
);

-- A window that is open RIGHT NOW in the row's own timezone, whatever the
-- server clock says. Built from the current time in that zone so the test
-- passes at any hour of any day.
insert into public.vendor_recurring_locations
  (id, organization_id, vendor_unit_id, latitude, longitude, public_label,
   timezone, days_of_week, start_time, end_time, created_by)
values (
  '50000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  40.7010, -74.0010, 'Corner pitch',
  'America/New_York',
  array[extract(dow from (now() at time zone 'America/New_York'))::smallint],
  ((now() at time zone 'America/New_York') - interval '1 hour')::time,
  ((now() at time zone 'America/New_York') + interval '1 hour')::time,
  '00000000-0000-0000-0000-0000000000c1'
);

select is(
  (select count(*)::int from public.nearby_vendor_locations(40.70, -74.00, 5)
    where state = 'RECURRING_NOW'),
  1,
  'A recurring window open now in its own timezone is returned'
);

select matches(
  (select reason_label from public.nearby_vendor_locations(40.70, -74.00, 5)
    where state = 'RECURRING_NOW'),
  '^Usually here',
  'A recurring result is labelled "Usually here", never "open" or "live"'
);

-- Same wall-clock window, a zone where it is a different time of day.
insert into public.vendor_recurring_locations
  (id, organization_id, vendor_unit_id, latitude, longitude, public_label,
   timezone, days_of_week, start_time, end_time, created_by)
values (
  '50000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000002',
  40.7020, -74.0020, 'Far pitch',
  'Pacific/Kiritimati',
  array[0,1,2,3,4,5,6]::smallint[],
  ((now() at time zone 'America/New_York') - interval '1 hour')::time,
  ((now() at time zone 'America/New_York') + interval '1 hour')::time,
  '00000000-0000-0000-0000-0000000000c2'
);

select is(
  (select count(*)::int from public.nearby_vendor_locations(40.70, -74.00, 5)
    where state = 'RECURRING_NOW'
      and public_label = 'Far pitch'),
  0,
  'The same wall-clock window in a far timezone does not match the local hour'
);

-- ----------------------------------------------------------------------------
-- Staleness — a pattern nobody reconfirmed is not a promise
-- ----------------------------------------------------------------------------

update public.vendor_recurring_locations
   set last_confirmed_at = now() - public.location_recurring_stale_after() - interval '1 day'
 where id = '50000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.nearby_vendor_locations(40.70, -74.00, 5)
    where state = 'RECURRING_NOW'),
  0,
  'A recurring pattern past its reconfirmation window disappears from results'
);

select is(
  (select is_current from public.vendor_recurring_location_previews
    where id = '50000000-0000-0000-0000-000000000001'),
  false,
  'The public view marks the stale pattern as not current rather than hiding the row'
);

-- Reconfirming restores it — the vendor action that keeps it alive.
update public.vendor_recurring_locations
   set last_confirmed_at = now()
 where id = '50000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.nearby_vendor_locations(40.70, -74.00, 5)
    where state = 'RECURRING_NOW'),
  1,
  'Reconfirming a pattern brings it back'
);

-- ----------------------------------------------------------------------------
-- Live overrides every prediction for the same unit
-- ----------------------------------------------------------------------------

insert into public.vendor_location_sessions
  (id, vendor_unit_id, organization_id, latitude, longitude, public_label, created_by)
values ('60000000-0000-0000-0000-000000000001',
        '40000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001',
        40.7015, -74.0015, 'Live spot', '00000000-0000-0000-0000-0000000000c1');

select is(
  (select count(*)::int from public.nearby_vendor_locations(40.70, -74.00, 5)
    where vendor_unit_id = '40000000-0000-0000-0000-000000000001'),
  1,
  'A unit that is live appears exactly once, not once per knowledge source'
);

select is(
  (select state from public.nearby_vendor_locations(40.70, -74.00, 5)
    where vendor_unit_id = '40000000-0000-0000-0000-000000000001'),
  'LIVE',
  'Live wins over the unit''s own recurring pattern'
);

select matches(
  (select reason_label from public.nearby_vendor_locations(40.70, -74.00, 5)
    where vendor_unit_id = '40000000-0000-0000-0000-000000000001'),
  '^Live — confirmed',
  'The live result explains itself with how recently it was confirmed'
);

select is(
  (select rank from public.nearby_vendor_locations(40.70, -74.00, 5)
    where vendor_unit_id = '40000000-0000-0000-0000-000000000001'),
  1,
  'Live ranks first'
);

-- ----------------------------------------------------------------------------
-- Scheduled occurrences
-- ----------------------------------------------------------------------------

insert into public.vendor_scheduled_occurrences
  (id, organization_id, vendor_unit_id, event_name, starts_at, ends_at,
   latitude, longitude, public_label, verification, created_by)
values
  -- Happening now.
  ('70000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
   '40000000-0000-0000-0000-000000000002', 'Night market',
   now() - interval '30 minutes', now() + interval '2 hours',
   40.7030, -74.0030, 'Market row', 'CONFIRMED', '00000000-0000-0000-0000-0000000000c2'),
  -- Already finished.
  ('70000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002',
   null, 'Yesterday market',
   now() - interval '2 days', now() - interval '47 hours',
   40.7040, -74.0040, 'Old row', 'CONFIRMED', '00000000-0000-0000-0000-0000000000c2'),
  -- Upcoming inside 24h.
  ('70000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002',
   null, 'Tomorrow market',
   now() + interval '6 hours', now() + interval '9 hours',
   40.7050, -74.0050, 'Soon row', 'CONFIRMED', '00000000-0000-0000-0000-0000000000c2');

select is(
  (select state from public.nearby_vendor_locations(40.70, -74.00, 5)
    where public_label = 'Market row'),
  'SCHEDULED_NOW',
  'An occurrence inside its window is scheduled-now'
);

select is(
  (select count(*)::int from public.nearby_vendor_locations(40.70, -74.00, 5)
    where public_label = 'Old row'),
  0,
  'A finished occurrence disappears'
);

select is(
  (select state from public.nearby_vendor_locations(40.70, -74.00, 5)
    where public_label = 'Soon row'),
  'SCHEDULED_UPCOMING',
  'An occurrence starting within 24h is labelled upcoming, not current'
);

select ok(
  (select rank from public.nearby_vendor_locations(40.70, -74.00, 5)
    where public_label = 'Market row')
  <
  (select rank from public.nearby_vendor_locations(40.70, -74.00, 5)
    where public_label = 'Soon row'),
  'Happening-now outranks upcoming'
);

-- ----------------------------------------------------------------------------
-- Unreviewed sources stay out of customer results
-- ----------------------------------------------------------------------------

insert into public.vendor_scheduled_occurrences
  (id, organizer_name, event_name, starts_at, ends_at, latitude, longitude,
   public_label, source_type, source_url, source_record_id, verification)
values ('70000000-0000-0000-0000-000000000004', 'Someone on social', 'Rumoured popup',
        now() - interval '10 minutes', now() + interval '2 hours',
        40.7060, -74.0060, 'Rumour row', 'SOCIAL_MEDIA_LEAD',
        'https://example.test/post/1', 'post-1', 'UNVERIFIED');

select is(
  (select count(*)::int from public.nearby_vendor_locations(40.70, -74.00, 5)
    where public_label = 'Rumour row'),
  0,
  'An unverified social lead never reaches customers, even inside its window'
);

select is(
  (select count(*)::int from public.vendor_scheduled_occurrence_previews
    where public_label = 'Rumour row'),
  0,
  'The public view excludes unreviewed leads at the source'
);

-- Idempotent import: the same upstream record twice is one row.
select throws_ok(
  $$ insert into public.vendor_scheduled_occurrences
       (organizer_name, event_name, starts_at, ends_at, latitude, longitude,
        source_type, source_record_id, verification)
     values ('Someone on social', 'Rumoured popup',
             now(), now() + interval '1 hour', 40.7060, -74.0060,
             'SOCIAL_MEDIA_LEAD', 'post-1', 'UNVERIFIED') $$,
  '23505', NULL,
  'Re-importing the same source record collides instead of duplicating'
);

-- ----------------------------------------------------------------------------
-- Hotspots are places, never vendors
-- ----------------------------------------------------------------------------

insert into public.location_hotspots
  (id, latitude, longitude, public_name, source_type, source_url,
   source_record_id, verification, review_notes, last_imported_at)
values ('80000000-0000-0000-0000-000000000001', 40.7070, -74.0070,
        'Permitted vending zone', 'MUNICIPAL_OPEN_DATA',
        'https://example.test/dataset/7', 'zone-7', 'CONFIRMED',
        'internal: reviewer thought this looked thin', now());

select is(
  (select count(*)::int from public.nearby_vendor_locations(40.70, -74.00, 5,
     true, true, true, false)),
  (select count(*)::int from public.nearby_vendor_locations(40.70, -74.00, 5,
     true, true, true, false)
    where state <> 'HOTSPOT'),
  'Hotspots are excluded by default — the customer sees vendors first'
);

select is(
  (select vendor_unit_id from public.nearby_vendor_locations(40.70, -74.00, 5,
     true, true, true, true)
    where state = 'HOTSPOT'),
  null,
  'A hotspot result carries no vendor at all'
);

select is(
  (select reason_label from public.nearby_vendor_locations(40.70, -74.00, 5,
     true, true, true, true)
    where state = 'HOTSPOT'),
  'Food-vendor hotspot — vendor not confirmed',
  'A hotspot says in words that no vendor is confirmed there'
);

select is(
  (select count(*)::int from public.nearby_vendor_locations(40.70, -74.00, 5,
     true, true, true, true)
    where state = 'HOTSPOT' and reason_label ilike '%open%'),
  0,
  'A hotspot is never described as open'
);

select is(
  (select count(*)::int
     from information_schema.columns
    where table_name = 'location_hotspot_previews'
      and column_name in ('review_notes', 'reviewed_by')),
  0,
  'Reviewer notes and reviewer identity are absent from the public view'
);

-- ----------------------------------------------------------------------------
-- Authorization
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-0000000000c2'); -- rival org's owner
select throws_ok(
  $$ insert into public.vendor_recurring_locations
       (organization_id, vendor_unit_id, latitude, longitude, timezone,
        days_of_week, start_time, end_time, created_by)
     values ('30000000-0000-0000-0000-000000000001',
             '40000000-0000-0000-0000-000000000001', 40.70, -74.00,
             'America/New_York', array[1]::smallint[], '11:00', '15:00',
             '00000000-0000-0000-0000-0000000000c2') $$,
  '42501', NULL,
  'One organization cannot add a schedule to another organization''s unit'
);

select is(
  (select count(*)::int from public.location_hotspots),
  0,
  'A vendor cannot read the hotspot staging table'
);

select is(
  (select count(*)::int from public.location_reports),
  0,
  'A vendor cannot read community reports or reporter identities'
);

select finish();
rollback;
