-- pgTAP adversarial tests for vendor_units: an organization may operate any
-- number of units, unit slugs are unique per-organization only (not
-- globally), organization isolation, unauthorized creation/edits, and
-- public-view routing/masking/filtering.
-- Run with: supabase test db   (see supabase/tests/README.md)
--
-- Covers: supabase/migrations/20260706000000_vendor_units.sql
--          supabase/migrations/20260707000000_vendor_units_multi.sql
--          supabase/migrations/20260708000000_vendor_units_custom_cuisines.sql
--
-- Self-contained: each pgTAP test file is wrapped in its own transaction
-- and rolled back, so the helper functions from 001_rls_policies.sql do
-- not persist here — they are redefined below, identically.
begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

-- ----------------------------------------------------------------------------
-- Fixtures: owner + manager + staff of "taco-cart", an unrelated vendor
-- owning "burger-truck" (where the same manager also holds a role, to
-- exercise cross-org membership), and a stranger with no membership
-- anywhere.
-- ----------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local',    'x', now(), '{"provider":"email"}', '{"display_name":"Owner"}'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@test.local',  'x', now(), '{"provider":"email"}', '{"display_name":"Manager"}'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@test.local',    'x', now(), '{"provider":"email"}', '{"display_name":"Staff"}'),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@test.local',    'x', now(), '{"provider":"email"}', '{"display_name":"Other Owner"}'),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger@test.local', 'x', now(), '{"provider":"email"}', '{"display_name":"Stranger"}');

-- Helper to impersonate an authenticated user at a given assurance level.
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

-- Count rows matched by an UPDATE ... statement under the current role/RLS.
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

-- ----------------------------------------------------------------------------
-- Creation: multiple units per org, per-org-unique slugs
-- ----------------------------------------------------------------------------

-- AAL1 owner: creation requires only membership, not MFA.
select test_as_user('00000000-0000-0000-0000-000000000001', 'aal1');

select lives_ok(
  $$ insert into public.vendor_units
       (id, organization_id, name, slug, unit_type, description, cuisine_categories, city,
        contact_phone, contact_phone_visible, contact_email, contact_email_visible,
        payment_methods, operating_status, created_by)
     values
       ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        'Taco Cart', 'taco-cart', 'food_truck', 'Tacos and more.',
        array['mexican', 'Oaxacan-style']::text[], 'Austin',
        '555-0100', false, 'owner@tacocart.test', false,
        array['cash']::public.payment_method[], 'open',
        '00000000-0000-0000-0000-000000000001') $$,
  'AAL1 owner can create a vendor unit'
);

select lives_ok(
  $$ insert into public.vendor_units
       (id, organization_id, name, slug, unit_type, city, created_by)
     values
       ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
        'Dessert Cart', 'dessert-cart', 'stand', 'Austin',
        '00000000-0000-0000-0000-000000000001') $$,
  'the same organization can create a second, different vendor unit (no one-per-org limit)'
);

select throws_ok(
  $$ insert into public.vendor_units
       (organization_id, name, slug, unit_type, city, created_by)
     values
       ('10000000-0000-0000-0000-000000000001', 'Taco Cart Again', 'taco-cart', 'stand', 'Austin',
        '00000000-0000-0000-0000-000000000001') $$,
  '23505',
  null,
  'a duplicate slug within the same organization is rejected'
);

select test_as_user('00000000-0000-0000-0000-000000000003', 'aal1');

select throws_ok(
  $$ insert into public.vendor_units
       (organization_id, name, slug, unit_type, city, created_by)
     values
       ('10000000-0000-0000-0000-000000000001', 'Staff Attempt', 'staff-attempt', 'stand', 'Austin',
        '00000000-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'staff cannot create a vendor unit (owner/manager only)'
);

-- Manager creates a unit for burger-truck reusing the *same slug* already
-- used by taco-cart's first unit — proves slug uniqueness is per-org only.
select test_as_user('00000000-0000-0000-0000-000000000002', 'aal1');

select lives_ok(
  $$ insert into public.vendor_units
       (id, organization_id, name, slug, unit_type, description, cuisine_categories, city,
        contact_phone, contact_phone_visible, contact_email, contact_email_visible,
        payment_methods, operating_status, created_by)
     values
       ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002',
        'Burger Truck', 'taco-cart', 'stand', 'Burgers done right.',
        array['american']::text[], 'Dallas',
        '555-0200', true, 'contact@burgertruck.test', true,
        array['cash','credit_card']::public.payment_method[], 'open',
        '00000000-0000-0000-0000-000000000002') $$,
  'a different organization may reuse a slug already used by another organization'
);

select test_as_anon();

select throws_ok(
  $$ insert into public.vendor_units
       (organization_id, name, slug, unit_type, city, created_by)
     values
       ('10000000-0000-0000-0000-000000000001', 'Anon Attempt', 'anon-attempt', 'stand', 'Austin',
        '00000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'anon cannot insert a vendor unit'
);

select test_as_user('00000000-0000-0000-0000-000000000005', 'aal1');

select throws_ok(
  $$ insert into public.vendor_units
       (organization_id, name, slug, unit_type, city, created_by)
     values
       ('10000000-0000-0000-0000-000000000001', 'Stranger Attempt', 'stranger-attempt', 'stand', 'Austin',
        '00000000-0000-0000-0000-000000000005') $$,
  '42501',
  null,
  'a user with no membership in the organization cannot insert a vendor unit'
);

-- ----------------------------------------------------------------------------
-- Viewing: base table is member-only and organization-isolated
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000001', 'aal1');

select is(
  (select count(*)::int from public.vendor_units),
  2,
  'owner sees both of their organization''s vendor units, not other orgs'''
);

select test_as_user('00000000-0000-0000-0000-000000000003', 'aal1');

select is(
  (select count(*)::int from public.vendor_units),
  2,
  'staff can view all of their organization''s vendor units (read allowed, write is not)'
);

select test_as_user('00000000-0000-0000-0000-000000000005', 'aal1');

select is(
  (select count(*)::int from public.vendor_units),
  0,
  'a stranger with no membership anywhere sees no vendor units via the base table'
);

select test_as_anon();

select is(
  (select count(*)::int from public.vendor_units),
  0,
  'anon reads no rows from the base table directly (RLS default deny)'
);

-- ----------------------------------------------------------------------------
-- Viewing: the public preview view is the only anonymous read path
-- ----------------------------------------------------------------------------

select is(
  (select count(*)::int from public.vendor_unit_previews),
  3,
  'anon sees all three vendor units (two orgs) through the public preview view'
);

select is(
  (select contact_phone from public.vendor_unit_previews
    where organization_slug = 'taco-cart' and slug = 'taco-cart'),
  null,
  'contact phone is nulled in the public view when contact_phone_visible is false'
);

select is(
  (select contact_phone from public.vendor_unit_previews
    where organization_slug = 'burger-truck' and slug = 'taco-cart'),
  '555-0200',
  'contact phone is shown in the public view when contact_phone_visible is true'
);

select is(
  (select organization_slug from public.vendor_unit_previews
    where organization_id = '10000000-0000-0000-0000-000000000001' and slug = 'dessert-cart'),
  'taco-cart',
  'the public view exposes organizations.slug as organization_slug'
);

-- cuisine_categories is now free-form text: a predefined value ('mexican')
-- and a custom vendor-entered tag ('Oaxacan-style') both round-trip through
-- the public view unchanged, since normalization/dedup happens at the app
-- layer, not the database.
select is(
  (select cuisine_categories from public.vendor_unit_previews
    where organization_slug = 'taco-cart' and slug = 'taco-cart'),
  array['mexican', 'Oaxacan-style'],
  'a custom cuisine tag alongside a predefined one round-trips through the public view'
);

-- Each public URL is (organization_slug, slug) together — same unit slug
-- under two different organizations must resolve to two different units.
select is(
  (select name from public.vendor_unit_previews
    where organization_slug = 'taco-cart' and slug = 'taco-cart'),
  'Taco Cart',
  'the (org slug, unit slug) pair resolves to the correct unit for taco-cart'
);

select is(
  (select name from public.vendor_unit_previews
    where organization_slug = 'burger-truck' and slug = 'taco-cart'),
  'Burger Truck',
  'the same unit slug under a different organization resolves to that organization''s own unit, not a cross-org match'
);

select is(
  (select name from public.vendor_unit_previews
    where organization_slug = 'taco-cart' and slug = 'dessert-cart'),
  'Dessert Cart',
  'a second unit within one organization resolves via its own distinct slug'
);

select test_as_service();

update public.organizations set status = 'suspended'
where slug = 'burger-truck';

select test_as_anon();

select is(
  (select count(*)::int from public.vendor_unit_previews),
  2,
  'a suspended organization''s vendor units are excluded from the public view'
);

-- ----------------------------------------------------------------------------
-- Updating
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000001', 'aal1');

select is(
  test_rows_updated(
    $$ update public.vendor_units set description = 'Updated by owner'
       where id = '20000000-0000-0000-0000-000000000001' $$),
  1,
  'owner can update one of their organization''s vendor units'
);

select test_as_user('00000000-0000-0000-0000-000000000003', 'aal1');

select is(
  test_rows_updated(
    $$ update public.vendor_units set description = 'Staff attempt'
       where id = '20000000-0000-0000-0000-000000000001' $$),
  0,
  'staff cannot update a vendor unit (owner/manager only)'
);

select test_as_user('00000000-0000-0000-0000-000000000001', 'aal1');

select is(
  test_rows_updated(
    $$ update public.vendor_units set description = 'Cross-org tampering attempt'
       where id = '20000000-0000-0000-0000-000000000003' $$),
  0,
  'an owner of one organization cannot update another organization''s vendor unit'
);

select test_as_user('00000000-0000-0000-0000-000000000002', 'aal1');

select is(
  test_rows_updated(
    $$ update public.vendor_units set description = 'Updated by manager'
       where id = '20000000-0000-0000-0000-000000000003' $$),
  1,
  'a manager can update a vendor unit belonging to an organization they manage'
);

select * from finish();

rollback;
