-- pgTAP adversarial tests for RLS policies, triggers, DEFINER functions, and
-- mandatory MFA (AAL2) enforcement.
-- Run with: supabase test db   (see supabase/tests/README.md)
--
-- Covers both migrations:
--   20260701000000_auth_tenancy_foundation.sql
--   20260702000000_mfa_enforcement_hardening.sql
begin;

create extension if not exists pgtap with schema extensions;

select plan(46);

-- ----------------------------------------------------------------------------
-- Fixtures: four users — vendor owner, vendor manager-to-be, customer,
-- and an unrelated vendor (for cross-org checks).
-- ----------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local',   'x', now(), '{"provider":"email"}', '{"display_name":"Owner"}'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@test.local', 'x', now(), '{"provider":"email"}', '{"display_name":"Manager"}'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer@test.local','x', now(), '{"provider":"email"}', '{"display_name":"Customer"}'),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@test.local',   'x', now(), '{"provider":"email"}', '{"display_name":"Other Vendor"}');

-- handle_new_user trigger should have created profiles for all four users.
select is(
  (select count(*)::int from public.profiles where id in (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004')),
  4,
  'handle_new_user trigger creates a profile per auth user'
);

-- Set account types as the service role (bypasses trigger protection since
-- current_user is postgres here).
update public.profiles set account_type = 'vendor',   onboarding_status = 'complete' where id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004');
update public.profiles set account_type = 'customer', onboarding_status = 'complete' where id = '00000000-0000-0000-0000-000000000003';

-- Helper to impersonate an authenticated user at a given assurance level
-- ('aal1' by default — a plain password-only session). Tests that need a
-- fully MFA-verified session pass aal => 'aal2' explicitly so the intent is
-- always visible at the call site.
create or replace function test_as_user(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
end;
$$;

-- Simulates a client/library trying to smuggle assurance level via any
-- claim other than the canonical top-level "aal" (which only Supabase
-- Auth's own TOTP verify flow can set). Used to prove the DB never trusts
-- anything else.
create or replace function test_as_user_with_forged_claims(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object(
      'sub', uid,
      'role', 'authenticated',
      'aal', 'aal1',
      'is_aal2', true,
      'user_metadata', json_build_object('aal', 'aal2', 'mfa_verified', true),
      'app_metadata', json_build_object('aal', 'aal2')
    )::text, true);
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

-- ----------------------------------------------------------------------------
-- Default deny: anonymous access
-- ----------------------------------------------------------------------------

select test_as_anon();

select is((select count(*)::int from public.profiles), 0,
  'anon reads no profiles');
select is((select count(*)::int from public.organizations), 0,
  'anon reads no organizations');
select is((select count(*)::int from public.organization_members), 0,
  'anon reads no memberships');
select is((select count(*)::int from public.platform_admins), 0,
  'anon reads no platform admins');
select throws_ok(
  $$ select public.create_organization_with_owner('Anon LLC', 'Anon', 'anon-org') $$,
  '42501',
  null,
  'anon cannot call create_organization_with_owner'
);

-- ----------------------------------------------------------------------------
-- Mandatory MFA: organization creation (initial owner bootstrap)
-- ----------------------------------------------------------------------------

-- AAL1 vendor: enrolled or not, a plain password-only session can never
-- create an organization. This is the "initial org creation cannot bypass
-- the MFA requirement" case — create_organization_with_owner is SECURITY
-- DEFINER (bypasses RLS entirely), so this must be an explicit in-function
-- check, not a policy.
select test_as_user('00000000-0000-0000-0000-000000000001', 'aal1');

select throws_ok(
  $$ select public.create_organization_with_owner('Taco Cart LLC', 'Taco Cart', 'taco-cart') $$,
  '42501',
  null,
  'AAL1 vendor cannot create an organization (MFA required, no bypass)'
);

select test_as_user('00000000-0000-0000-0000-000000000001', 'aal2');

select lives_ok(
  $$ select public.create_organization_with_owner('Taco Cart LLC', 'Taco Cart', 'taco-cart') $$,
  'AAL2 vendor can create an organization'
);

select test_as_service();

select is(
  (select count(*)::int from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where o.slug = 'taco-cart' and m.role = 'owner' and m.status = 'active'
      and m.user_id = '00000000-0000-0000-0000-000000000001'),
  1,
  'org creation atomically creates the active owner membership'
);

-- Customer, even at aal2, is rejected by the role check — proves the two
-- gates (MFA and account_type) are independent of each other.
select test_as_user('00000000-0000-0000-0000-000000000003', 'aal2');

select throws_ok(
  $$ select public.create_organization_with_owner('Customer LLC', 'Customer Org', 'customer-org') $$,
  '42501',
  null,
  'AAL2 customer account still cannot create an organization (role gate)'
);

select test_as_user('00000000-0000-0000-0000-000000000001', 'aal2');

select throws_ok(
  $$ select public.create_organization_with_owner('Bad Slug LLC', 'Bad Slug', 'Bad Slug!!') $$,
  '23514',
  null,
  'invalid slug is rejected server-side'
);

select throws_ok(
  $$ insert into public.organizations (legal_name, display_name, slug, created_by)
     values ('Direct LLC', 'Direct', 'direct-org', '00000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'direct insert into organizations is denied (must use DB function)'
);

-- Second org for cross-org tests (owned by user 4), also gated by MFA.
select test_as_user('00000000-0000-0000-0000-000000000004', 'aal2');
select lives_ok(
  $$ select public.create_organization_with_owner('Burger Truck LLC', 'Burger Truck', 'burger-truck') $$,
  'second vendor (AAL2) creates their own organization'
);

-- ----------------------------------------------------------------------------
-- Profiles (MFA is optional here — customers are never required to enroll)
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000003', 'aal1');

select is(
  (select count(*)::int from public.profiles),
  1,
  'customer sees only their own profile (no shared orgs)'
);

select lives_ok(
  $$ update public.profiles set display_name = 'Cool Customer'
     where id = '00000000-0000-0000-0000-000000000003' $$,
  'user can update own display name at aal1 (MFA optional for customers)'
);

select throws_ok(
  $$ update public.profiles set account_type = 'vendor'
     where id = '00000000-0000-0000-0000-000000000003' $$,
  '42501',
  null,
  'customer cannot flip account_type to vendor (role escalation blocked)'
);

-- Update against someone else's row: RLS filters it to zero rows.
select is(
  (with updated as (
     update public.profiles set display_name = 'hax'
     where id = '00000000-0000-0000-0000-000000000001'
     returning 1)
   select count(*)::int from updated),
  0,
  'user cannot update another user''s profile (0 rows matched)'
);

-- ----------------------------------------------------------------------------
-- Organizations: reads and updates (mandatory MFA for owner writes)
-- ----------------------------------------------------------------------------

select is(
  (select count(*)::int from public.organizations),
  0,
  'customer (non-member) sees no organizations'
);

select test_as_user('00000000-0000-0000-0000-000000000001', 'aal2');

select is(
  (select slug from public.organizations),
  'taco-cart',
  'owner sees only their own organization (cross-org read blocked)'
);

-- AAL1 owner: role is right but the session is not MFA-verified — sensitive
-- write is silently filtered to 0 rows by the restrictive policy.
select test_as_user('00000000-0000-0000-0000-000000000001', 'aal1');

select is(
  (with updated as (
     update public.organizations set display_name = 'AAL1 Attempt'
     where slug = 'taco-cart'
     returning 1)
   select count(*)::int from updated),
  0,
  'AAL1 owner cannot update organization settings (MFA mandatory, not optional)'
);

select test_as_user('00000000-0000-0000-0000-000000000001', 'aal2');

select lives_ok(
  $$ update public.organizations set display_name = 'Taco Cart Deluxe' where slug = 'taco-cart' $$,
  'AAL2 owner can update own organization'
);

select is(
  (with updated as (
     update public.organizations set display_name = 'hax'
     where slug = 'burger-truck'
     returning 1)
   select count(*)::int from updated),
  0,
  'owner cannot update a different organization (0 rows matched)'
);

select throws_ok(
  $$ update public.organizations set created_by = '00000000-0000-0000-0000-000000000002'
     where slug = 'taco-cart' $$,
  '42501',
  null,
  'protected organization fields cannot be changed'
);

-- ----------------------------------------------------------------------------
-- Memberships: invite, duplicates, escalation, final owner, mandatory MFA
-- ----------------------------------------------------------------------------

-- Owner (AAL2) invites user 2 as manager.
select lives_ok(
  $$ insert into public.organization_members (organization_id, user_id, role, status, invited_by)
     values ((select id from public.organizations where slug = 'taco-cart'),
             '00000000-0000-0000-0000-000000000002', 'manager', 'active',
             '00000000-0000-0000-0000-000000000001') $$,
  'AAL2 owner can add a manager'
);

select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role, status, invited_by)
     values ((select id from public.organizations where slug = 'taco-cart'),
             '00000000-0000-0000-0000-000000000002', 'staff', 'active',
             '00000000-0000-0000-0000-000000000001') $$,
  '23505',
  null,
  'duplicate active membership for same (org, user) is rejected'
);

-- Owner cannot change own role (self-change blocked even for owners, even
-- at aal2 — this is a business-rule trigger, not an MFA gate).
select throws_ok(
  $$ update public.organization_members set role = 'staff'
     where user_id = '00000000-0000-0000-0000-000000000001'
       and organization_id = (select id from public.organizations where slug = 'taco-cart') $$,
  '42501',
  null,
  'member cannot change their own role (final owner also protected)'
);

-- Owner cannot delete self while final owner.
select throws_ok(
  $$ delete from public.organization_members
     where user_id = '00000000-0000-0000-0000-000000000001'
       and organization_id = (select id from public.organizations where slug = 'taco-cart') $$,
  '42501',
  null,
  'final owner cannot remove themselves without ownership transfer'
);

-- Owner cannot bypass MFA via a direct role-assignment request either, even
-- though they hold full owner permissions: dropping back to aal1 blocks the
-- write regardless of what the request contains.
select test_as_user('00000000-0000-0000-0000-000000000001', 'aal1');

select is(
  (with updated as (
     update public.organization_members set role = 'manager'
     where user_id = '00000000-0000-0000-0000-000000000002'
       and organization_id = (select id from public.organizations where slug = 'taco-cart')
     returning 1)
   select count(*)::int from updated),
  0,
  'owner cannot bypass MFA via a direct role-assignment DB request at aal1'
);

-- AAL1 manager cannot perform sensitive membership writes either (insert
-- fails outright rather than matching 0 rows, since INSERT has no existing
-- row to filter).
select test_as_user('00000000-0000-0000-0000-000000000002', 'aal1');

select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role, status, invited_by)
     values ((select id from public.organizations where slug = 'taco-cart'),
             '00000000-0000-0000-0000-000000000003', 'staff', 'active',
             '00000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'AAL1 manager cannot add a staff member (MFA mandatory, not optional)'
);

-- Manager checks, now AAL2-verified.
select test_as_user('00000000-0000-0000-0000-000000000002', 'aal2');

select is(
  (select count(*)::int from public.organization_members
    where organization_id = (select id from public.organizations where slug = 'taco-cart')),
  2,
  'manager can view the org roster'
);

select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role, status, invited_by)
     values ((select id from public.organizations where slug = 'taco-cart'),
             '00000000-0000-0000-0000-000000000003', 'owner', 'active',
             '00000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'AAL2 manager still cannot grant the owner role (role gate, not MFA)'
);

select lives_ok(
  $$ insert into public.organization_members (organization_id, user_id, role, status, invited_by)
     values ((select id from public.organizations where slug = 'taco-cart'),
             '00000000-0000-0000-0000-000000000003', 'staff', 'active',
             '00000000-0000-0000-0000-000000000002') $$,
  'AAL2 manager can add staff'
);

select throws_ok(
  $$ update public.organization_members set role = 'owner'
     where user_id = '00000000-0000-0000-0000-000000000002'
       and organization_id = (select id from public.organizations where slug = 'taco-cart') $$,
  '42501',
  null,
  'manager cannot promote themselves to owner'
);

-- ----------------------------------------------------------------------------
-- Forged-claim resistance: only the canonical top-level "aal" JWT claim
-- (set exclusively by Supabase Auth's own TOTP verify flow) counts. No
-- custom, client-writable field can fake an MFA-verified session.
-- ----------------------------------------------------------------------------

select test_as_user_with_forged_claims('00000000-0000-0000-0000-000000000001');

select is(
  (select public.mfa_assurance_ok()),
  false,
  'forged nested/extra claims (is_aal2, user_metadata.aal, app_metadata.aal) do not grant aal2'
);

select is(
  (with updated as (
     update public.organizations set display_name = 'Forged Claim Attempt'
     where slug = 'taco-cart'
     returning 1)
   select count(*)::int from updated),
  0,
  'forged claims cannot be used to perform a sensitive org write'
);

-- ----------------------------------------------------------------------------
-- Staff checks
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000003', 'aal1');

select is(
  (select count(*)::int from public.organization_members
    where organization_id = (select id from public.organizations where slug = 'taco-cart')),
  1,
  'staff see only their own membership row'
);

select is(
  (with updated as (
     update public.organization_members set role = 'manager'
     where user_id = '00000000-0000-0000-0000-000000000003'
     returning 1)
   select count(*)::int from updated),
  0,
  'staff cannot promote anyone (update matches 0 rows)'
);

-- ----------------------------------------------------------------------------
-- Cross-org isolation (independent of assurance level — MFA never widens
-- access to a different tenant)
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000004', 'aal2');

select is(
  (select count(*)::int from public.organization_members
    where organization_id = (select id from public.organizations o where o.slug = 'taco-cart')),
  0,
  'cross-org membership reads are blocked even at aal2'
);

select is(
  (with inserted as (
     insert into public.organization_members (organization_id, user_id, role, status, invited_by)
     select o.id, '00000000-0000-0000-0000-000000000004', 'owner', 'active',
            '00000000-0000-0000-0000-000000000004'
     from public.organizations o
     where o.slug = 'taco-cart'
     returning 1)
   select count(*)::int from inserted),
  0,
  'outsider cannot insert themselves into another org (0 rows: org invisible)'
);

-- A taco-cart manager, fully MFA-verified, still cannot touch burger-truck.
select test_as_user('00000000-0000-0000-0000-000000000002', 'aal2');

select is(
  (with updated as (
     update public.organizations set display_name = 'hax2'
     where slug = 'burger-truck'
     returning 1)
   select count(*)::int from updated),
  0,
  'AAL2 manager of one org cannot update a different organization'
);

-- ----------------------------------------------------------------------------
-- Platform admins: writes always denied, reads always require AAL2
-- ----------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.platform_admins (user_id)
     values ('00000000-0000-0000-0000-000000000004') $$,
  '42501',
  null,
  'authenticated user cannot self-assign a platform admin role'
);

-- Grant admin via service role (simulating a migration / service-role write).
select test_as_service();
insert into public.platform_admins (user_id, note)
values ('00000000-0000-0000-0000-000000000004', 'test admin');

-- At aal1, admin-level access is NOT recognized anywhere it matters: the
-- table row exists, but is_platform_admin() (used by every cross-tenant
-- read policy) requires aal2.
select test_as_user('00000000-0000-0000-0000-000000000004', 'aal1');

select is(
  (select public.is_platform_admin()),
  false,
  'AAL1 admin session is not recognized as platform admin (AAL2 mandatory)'
);

select is(
  (select count(*)::int from public.organizations),
  1,
  'AAL1 admin sees only their own organization (no cross-tenant admin bypass)'
);

select test_as_user('00000000-0000-0000-0000-000000000004', 'aal2');

select is(
  (select public.is_platform_admin()),
  true,
  'is_platform_admin() reflects service-role-granted admin status once aal2'
);

select is(
  (select count(*)::int from public.organizations),
  2,
  'AAL2 platform admin can read all organizations'
);

select test_as_user('00000000-0000-0000-0000-000000000001', 'aal2');

select is(
  (select public.is_platform_admin()),
  false,
  'regular user is not a platform admin'
);

select * from finish();

rollback;
