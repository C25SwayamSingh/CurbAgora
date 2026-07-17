-- pgTAP adversarial tests for vendor unit photos: the vendor-photos bucket
-- is public-read, writes are owner/manager-only and scoped to the object
-- path's {organization_id}/{vendor_unit_id}/ prefix, a cross-tenant
-- org/unit mismatch in the path is rejected, and the public view exposes
-- primary_image_path.
-- Run with: supabase test db   (see supabase/tests/README.md)
--
-- Covers: supabase/migrations/20260711000000_vendor_unit_photos.sql
--
-- Self-contained: each pgTAP test file is wrapped in its own transaction
-- and rolled back, so the helper functions from 001_rls_policies.sql do
-- not persist here — they are redefined below, identically.
begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

-- ----------------------------------------------------------------------------
-- Fixtures: owner + manager + staff of "taco-cart", a second org
-- "burger-truck", a stranger, and one vendor unit per org.
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

-- Works for DELETE too: any statement supporting RETURNING.
create or replace function test_rows_affected(mutation_sql text) returns int language plpgsql as $$
declare row_count int;
begin
  execute format(
    'with affected as (%s returning 1) select count(*)::int from affected',
    mutation_sql
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
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'owner', 'active');

insert into public.vendor_units (id, organization_id, name, slug, unit_type, city, state, created_by)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Taco Cart', 'taco-cart', 'food_truck', 'Austin', 'TX', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Burger Truck', 'burger-truck', 'food_truck', 'Dallas', 'TX', '00000000-0000-0000-0000-000000000004');

-- ----------------------------------------------------------------------------
-- Bucket configuration
-- ----------------------------------------------------------------------------

select is(
  (select public from storage.buckets where id = 'vendor-photos'),
  true,
  'vendor-photos bucket exists and is public (photos appear on public pages)'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'vendor-photos'),
  array['image/jpeg', 'image/png', 'image/webp'],
  'vendor-photos bucket only allows image MIME types'
);

-- ----------------------------------------------------------------------------
-- Uploads (inserts): owner/manager of the path''s org only, and the path''s
-- org/unit pair must really belong together
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('vendor-photos',
       '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/photo-owner.jpg') $$,
  'owner can upload under their own {org}/{unit}/ path'
);

select test_as_user('00000000-0000-0000-0000-000000000002');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('vendor-photos',
       '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/photo-manager.jpg') $$,
  'manager can upload under their own {org}/{unit}/ path'
);

select test_as_user('00000000-0000-0000-0000-000000000003');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('vendor-photos',
       '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/photo-staff.jpg') $$,
  '42501',
  null,
  'staff cannot upload (photo management is owner/manager-only, unlike going live)'
);

select test_as_user('00000000-0000-0000-0000-000000000005');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('vendor-photos',
       '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/photo-stranger.jpg') $$,
  '42501',
  null,
  'a stranger with no membership cannot upload anywhere'
);

select test_as_user('00000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('vendor-photos',
       '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000002/photo-spoof.jpg') $$,
  '42501',
  null,
  'a path naming the caller''s own org but ANOTHER org''s unit id is rejected (cross-tenant guard)'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('vendor-photos',
       '10000000-0000-0000-0000-000000000002/20000000-0000-0000-0000-000000000002/photo-foreign.jpg') $$,
  '42501',
  null,
  'an owner of one org cannot upload into another org''s path'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('vendor-photos', 'photo-rootlevel.jpg') $$,
  '42501',
  null,
  'a path without the {org}/{unit}/ folder structure is rejected'
);

-- ----------------------------------------------------------------------------
-- Reads: public bucket, everyone (including anon) can see the objects
-- ----------------------------------------------------------------------------

select test_as_anon();

-- Scoped to the fixture org's path prefix: the local database may hold
-- real photos from manual testing, which are not this test's concern.
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'vendor-photos'
     and name like '10000000-0000-0000-0000-000000000001/%'),
  2,
  'anon can read vendor photo objects (public bucket backing public pages)'
);

-- ----------------------------------------------------------------------------
-- Deletes: owner/manager only; others silently affect zero rows
-- ----------------------------------------------------------------------------

-- storage.protect_delete blocks ALL direct SQL deletes on storage.objects
-- regardless of RLS (the real app deletes via the Storage API, which
-- manages this flag itself). Allow direct deletes for this transaction so
-- the DELETE policies themselves are what gets tested.
select set_config('storage.allow_delete_query', 'true', true);

select test_as_user('00000000-0000-0000-0000-000000000003');

select is(
  test_rows_affected(
    $$ delete from storage.objects
       where bucket_id = 'vendor-photos'
         and name = '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/photo-owner.jpg' $$
  ),
  0,
  'staff cannot delete photos'
);

select test_as_user('00000000-0000-0000-0000-000000000005');

select is(
  test_rows_affected(
    $$ delete from storage.objects
       where bucket_id = 'vendor-photos'
         and name = '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/photo-owner.jpg' $$
  ),
  0,
  'a stranger cannot delete photos'
);

select test_as_user('00000000-0000-0000-0000-000000000001');

select is(
  test_rows_affected(
    $$ delete from storage.objects
       where bucket_id = 'vendor-photos'
         and name = '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/photo-owner.jpg' $$
  ),
  1,
  'owner can delete their own unit''s photo'
);

-- ----------------------------------------------------------------------------
-- Public view exposes the photo path
-- ----------------------------------------------------------------------------

select test_as_service();

update public.vendor_units
  set primary_image_path = '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/photo-manager.jpg'
  where id = '20000000-0000-0000-0000-000000000001';

select test_as_anon();

select is(
  (select primary_image_path from public.vendor_unit_previews
   where organization_slug = 'taco-cart' and slug = 'taco-cart'),
  '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/photo-manager.jpg',
  'vendor_unit_previews exposes primary_image_path to anonymous readers'
);

select is(
  (select primary_image_path from public.vendor_unit_previews
   where organization_slug = 'burger-truck' and slug = 'burger-truck'),
  null::text,
  'units without a photo expose a null primary_image_path (UI falls back to initials)'
);

select * from finish();
rollback;
