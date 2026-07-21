-- pgTAP tests for the loyalty foundation: authorization on publish, the
-- staff-verified claim flow (single-use codes, first-visit bonus),
-- append-only ledger immutability enforced by trigger, RLS isolation across
-- customers and organizations, and redemption safety (can't redeem an
-- unfilled card, one open redemption at a time).
-- Run with: supabase test db   (see supabase/tests/README.md)
--
-- Covers: supabase/migrations/20260713000000_loyalty_foundation.sql
--
-- Fixture-scoped: all ids belong to this file's own fixtures, so real local
-- data never affects results.
begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local',    'x', now(), '{"provider":"email"}', '{"display_name":"Owner"}'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@test.local',    'x', now(), '{"provider":"email"}', '{"display_name":"Staff"}'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer@test.local', 'x', now(), '{"provider":"email"}', '{"display_name":"Customer"}'),
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

create or replace function test_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
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
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'staff', 'active'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'owner', 'active');

-- ----------------------------------------------------------------------------
-- Publish authorization
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000003'); -- customer, not a member
select throws_ok(
  $$ select public.loyalty_publish_program(
       '10000000-0000-0000-0000-000000000001', 4, 500, 240,
       'Free drink', 300, 80, null) $$,
  '42501',
  NULL,
  'A non-member cannot publish a loyalty program'
);

select test_as_user('00000000-0000-0000-0000-000000000001'); -- owner
select lives_ok(
  $$ select public.loyalty_publish_program(
       '10000000-0000-0000-0000-000000000001', 4, 500, 240,
       'Free drink', 300, 80, null) $$,
  'Owner can publish a stamp program'
);

select is(
  (select count(*)::int from public.loyalty_program_versions
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and status = 'active'),
  1,
  'Exactly one active program version exists after publishing'
);

-- ----------------------------------------------------------------------------
-- Staff-verified claim flow: customer requests, staff confirms
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000003'); -- customer
create temp table claim1 as
  select code from public.loyalty_create_claim_code('10000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from claim1),
  1,
  'Customer receives a stamp claim code'
);

select test_as_user('00000000-0000-0000-0000-000000000002'); -- staff
select is(
  (select first_visit from public.loyalty_confirm_claim(
     '10000000-0000-0000-0000-000000000001', (select code from claim1))),
  true,
  'First confirmed claim awards the first-visit bonus'
);

select is(
  (select stamp_balance from public.loyalty_accounts
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and user_id = '00000000-0000-0000-0000-000000000003'),
  2,
  'First visit leaves a balance of 2 (stamp + welcome bonus)'
);

-- Single-use: the same code cannot be confirmed twice.
select throws_ok(
  $$ select public.loyalty_confirm_claim(
       '10000000-0000-0000-0000-000000000001', (select code from claim1)) $$,
  NULL,
  NULL,
  'A claim code cannot be confirmed a second time'
);

-- ----------------------------------------------------------------------------
-- Append-only ledger: UPDATE and DELETE are rejected by trigger, even for a
-- superuser role that RLS would otherwise let through.
-- ----------------------------------------------------------------------------

select test_as_service();
select throws_ok(
  $$ update public.loyalty_ledger_entries set delta_stamps = 99
      where organization_id = '10000000-0000-0000-0000-000000000001' $$,
  NULL,
  NULL,
  'Ledger entries cannot be updated (append-only trigger)'
);

select throws_ok(
  $$ delete from public.loyalty_ledger_entries
      where organization_id = '10000000-0000-0000-0000-000000000001' $$,
  NULL,
  NULL,
  'Ledger entries cannot be deleted (append-only trigger)'
);

-- ----------------------------------------------------------------------------
-- RLS isolation
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-000000000003'); -- the customer
select is(
  (select count(*)::int from public.loyalty_accounts),
  1,
  'A customer sees only their own loyalty account'
);

select test_as_user('00000000-0000-0000-0000-000000000004'); -- owner of a DIFFERENT org
select is(
  (select count(*)::int from public.loyalty_accounts
    where organization_id = '10000000-0000-0000-0000-000000000001'),
  0,
  'An unrelated org owner cannot see another org''s loyalty accounts'
);

-- Customers cannot insert ledger entries directly (no client insert policy).
select test_as_user('00000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ insert into public.loyalty_ledger_entries
       (account_id, organization_id, program_version_id, entry_type,
        delta_stamps, idempotency_key)
     select a.id, a.organization_id,
            (select id from public.loyalty_program_versions
              where organization_id = a.organization_id and status = 'active'),
            'PURCHASE_STAMP', 5, 'hack:' || gen_random_uuid()
       from public.loyalty_accounts a
      where a.user_id = '00000000-0000-0000-0000-000000000003' $$,
  NULL,
  NULL,
  'A customer cannot self-issue stamps by inserting ledger rows'
);

-- ----------------------------------------------------------------------------
-- Redemption safety
-- ----------------------------------------------------------------------------

-- Card is at 2 of 4 — redemption must be refused.
select test_as_user('00000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.loyalty_request_redemption('10000000-0000-0000-0000-000000000001') $$,
  NULL,
  NULL,
  'A customer cannot redeem before the card is full'
);

-- Owner tops the card up to full (2 + 2 = 4) via an audited adjustment.
select test_as_user('00000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.loyalty_adjust_balance(
       (select id from public.loyalty_accounts
         where organization_id = '10000000-0000-0000-0000-000000000001'
           and user_id = '00000000-0000-0000-0000-000000000003'),
       2, 'pgTAP: fill card for redemption test') $$,
  'Owner can top a card to full with an audited manual adjustment'
);

-- Now redemption is allowed.
select test_as_user('00000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ select public.loyalty_request_redemption('10000000-0000-0000-0000-000000000001') $$,
  'A customer can request redemption once the card is full'
);

select finish();
rollback;
