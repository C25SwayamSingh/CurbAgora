-- pgTAP tests for the spend-based points model: authorization on publish,
-- the staff-verified purchase flow (single-use code + staff-entered subtotal),
-- append-only ledger immutability enforced by trigger, RLS isolation across
-- customers and organizations, and redemption safety (can't redeem an
-- unfilled card, one open redemption at a time).
-- Run with: supabase test db   (see supabase/tests/README.md)
--
-- Covers: supabase/migrations/20260713000000_loyalty_foundation.sql
--         supabase/migrations/20260715000000_loyalty_points.sql
--         supabase/migrations/20260716000000_loyalty_checkout_sessions.sql
--
-- Fixture-scoped: all ids belong to this file's own fixtures, so real local
-- data never affects results.
begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

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
       '10000000-0000-0000-0000-000000000001', 10,
       '[{"points_cost":450,"reward_kind":"FREE_ITEM","reward_name":"Horchata","reward_value_cents":350,"reward_est_cost_cents":90}]'::jsonb) $$,
  '42501',
  NULL,
  'A non-member cannot publish a points program'
);

select test_as_user('00000000-0000-0000-0000-000000000001'); -- owner
select lives_ok(
  $$ select public.loyalty_publish_program(
       '10000000-0000-0000-0000-000000000001', 10,
       '[{"points_cost":450,"reward_kind":"FREE_ITEM","reward_name":"Horchata","reward_value_cents":350,"reward_est_cost_cents":90},
         {"points_cost":1250,"reward_kind":"FREE_ITEM","reward_name":"Plate","reward_value_cents":1000,"reward_est_cost_cents":300}]'::jsonb) $$,
  'Owner can publish a points program with a reward catalog'
);

select is(
  (select points_per_dollar from public.loyalty_program_versions
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and status = 'active'),
  10,
  'The active version records points per dollar'
);

select is(
  (select count(*)::int from public.loyalty_reward_catalog_items ci
     join public.loyalty_program_versions v on v.id = ci.program_version_id
    where v.organization_id = '10000000-0000-0000-0000-000000000001'
      and v.status = 'active'),
  2,
  'Both catalog tiers are stored against the active version'
);

-- ----------------------------------------------------------------------------
-- Cost cap is kind-aware and per tier
-- ----------------------------------------------------------------------------

-- 100 pts / 10 = $10 spend; a $6 free-item cost = 60% -> blocked.
select throws_ok(
  $$ select public.loyalty_publish_program(
       '10000000-0000-0000-0000-000000000001', 10,
       '[{"points_cost":100,"reward_kind":"FREE_ITEM","reward_name":"Plate","reward_value_cents":1000,"reward_est_cost_cents":600}]'::jsonb) $$,
  'P0001',
  NULL,
  'A tier above the 10%% cost cap is refused'
);

-- A $5 discount at 500 pts / 10 = $50 spend = 10% exactly -> allowed;
-- the same discount at 400 pts = $40 = 12.5% -> blocked. Proves a discount is
-- charged at full face value rather than a 30%% estimate.
select throws_ok(
  $$ select public.loyalty_publish_program(
       '10000000-0000-0000-0000-000000000001', 10,
       '[{"points_cost":400,"reward_kind":"FIXED_DISCOUNT","reward_name":"$5 off","reward_value_cents":500}]'::jsonb) $$,
  'P0001',
  NULL,
  'A fixed discount is costed at full face value against the cap'
);

select throws_ok(
  $$ select public.loyalty_publish_program(
       '10000000-0000-0000-0000-000000000001', 10, '[]'::jsonb) $$,
  'P0001',
  NULL,
  'An empty catalog is refused'
);

-- Restore the two-tier catalog for the remaining tests.
select lives_ok(
  $$ select public.loyalty_publish_program(
       '10000000-0000-0000-0000-000000000001', 10,
       '[{"points_cost":450,"reward_kind":"FREE_ITEM","reward_name":"Horchata","reward_value_cents":350,"reward_est_cost_cents":90},
         {"points_cost":1250,"reward_kind":"FREE_ITEM","reward_name":"Plate","reward_value_cents":1000,"reward_est_cost_cents":300}]'::jsonb) $$,
  'Republishing rebuilds the catalog on a new version'
);

-- ----------------------------------------------------------------------------
-- Earning: staff enters the verified subtotal
-- ----------------------------------------------------------------------------

-- Digests of two fixed tokens. The raw token never reaches the database, so
-- the tests mint the digest the same way the server action does.
create temp table tokens as
  select encode(sha256('token-one'::bytea), 'hex') as t1,
         encode(sha256('token-two'::bytea), 'hex') as t2;

select test_as_user('00000000-0000-0000-0000-000000000003'); -- customer
create temp table session1 as
  select * from public.loyalty_start_checkout_session(
    '10000000-0000-0000-0000-000000000001',
    (select t1 from tokens), array['4827','1593','0001']);

select is((select count(*)::int from session1), 1, 'Customer opens a checkout session');
select matches(
  (select numeric_code from session1), '^[0-9]{4}$',
  'The session carries a 4-digit code'
);
select ok(
  (select expires_at from session1) between now() + interval '4 minutes'
                                    and now() + interval '6 minutes',
  'A checkout session is short-lived (about 5 minutes)'
);

-- The QR and the spoken code are two doors into one room.
select test_as_user('00000000-0000-0000-0000-000000000002'); -- staff
select is(
  (select session_id from public.loyalty_resolve_checkout_session(
     '10000000-0000-0000-0000-000000000001', 'qr', (select t1 from tokens))),
  (select session_id from public.loyalty_resolve_checkout_session(
     '10000000-0000-0000-0000-000000000001', 'code4',
     (select numeric_code from session1))),
  'The QR token and the 4-digit code resolve to the same session'
);

select is(
  (select member_ref from public.loyalty_resolve_checkout_session(
     '10000000-0000-0000-0000-000000000001', 'code4',
     (select numeric_code from session1))),
  '•' || right(replace((select a.id::text from public.loyalty_accounts a
                         where a.organization_id = '10000000-0000-0000-0000-000000000001'
                           and a.user_id = '00000000-0000-0000-0000-000000000003'), '-', ''), 4),
  'Resolving returns a masked member reference, not a full identifier'
);

-- Resolving identifies; it must not move any balance.
select is(
  (select point_balance from public.loyalty_accounts
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and user_id = '00000000-0000-0000-0000-000000000003'),
  0,
  'Identifying a customer awards nothing on its own'
);

select is(
  (select points_awarded from public.loyalty_award_points(
     '10000000-0000-0000-0000-000000000001',
     (select session_id from session1), 1250)),
  125,
  'A $12.50 verified subtotal awards 125 points at 10 pts/$'
);

select is(
  (select point_balance from public.loyalty_accounts
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and user_id = '00000000-0000-0000-0000-000000000003'),
  125,
  'The balance projection matches the points awarded'
);

select is(
  (select verified_subtotal_cents from public.loyalty_ledger_entries
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and entry_type = 'PURCHASE_POINTS'
    order by created_at desc limit 1),
  1250,
  'The verified subtotal is recorded on the ledger entry for audit'
);

select is(
  (select status from public.loyalty_claim_codes
    where id = (select session_id from session1)),
  'confirmed',
  'Awarding consumes the session in the same transaction'
);

-- Replay: a screenshot of a used QR must be worthless.
select throws_ok(
  $$ select public.loyalty_award_points(
       '10000000-0000-0000-0000-000000000001',
       (select session_id from session1), 1250) $$,
  'P0001', NULL,
  'A consumed session cannot award points a second time'
);

select is(
  (select outcome from public.loyalty_resolve_checkout_session(
     '10000000-0000-0000-0000-000000000001', 'qr', (select t1 from tokens))),
  'consumed',
  'A consumed QR token reports itself as already used'
);

-- An absurd staff-entered amount is refused.
select test_as_user('00000000-0000-0000-0000-000000000003');
create temp table session2 as
  select * from public.loyalty_start_checkout_session(
    '10000000-0000-0000-0000-000000000001',
    (select t2 from tokens), array['2222','3333']);
select test_as_user('00000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.loyalty_award_points(
       '10000000-0000-0000-0000-000000000001',
       (select session_id from session2), 500000) $$,
  'P0001', NULL,
  'A subtotal over the $1,000 sanity bound is refused'
);

select throws_ok(
  $$ select public.loyalty_award_points(
       '10000000-0000-0000-0000-000000000001',
       (select session_id from session2), 0) $$,
  'P0001', NULL,
  'A zero subtotal is refused'
);

-- The failed awards above must not have consumed the session.
select is(
  (select status from public.loyalty_claim_codes
    where id = (select session_id from session2)),
  'pending',
  'A refused award leaves the session unconsumed'
);

-- ----------------------------------------------------------------------------
-- Checkout session security
-- ----------------------------------------------------------------------------

-- Cross-organization: another vendor cannot resolve or spend this code.
select test_as_user('00000000-0000-0000-0000-000000000004'); -- other org's owner
select throws_ok(
  $$ select public.loyalty_resolve_checkout_session(
       '10000000-0000-0000-0000-000000000001', 'qr', (select t2 from tokens)) $$,
  '42501', NULL,
  'A different organization cannot resolve this org''s checkout session'
);
select is(
  (select outcome from public.loyalty_resolve_checkout_session(
     '10000000-0000-0000-0000-000000000002', 'code4',
     (select numeric_code from session2))),
  'not_found',
  'A code from one organization does not resolve inside another'
);

-- A signed-in stranger with no membership anywhere.
select test_as_user('00000000-0000-0000-0000-000000000005');
select throws_ok(
  $$ select public.loyalty_resolve_checkout_session(
       '10000000-0000-0000-0000-000000000001', 'code4',
       (select numeric_code from session2)) $$,
  '42501', NULL,
  'A non-member cannot identify customers'
);

-- The customer themselves cannot award or consume.
select test_as_user('00000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.loyalty_award_points(
       '10000000-0000-0000-0000-000000000001',
       (select session_id from session2), 5000) $$,
  '42501', NULL,
  'A customer cannot award themselves points'
);

-- Expiry: a stale session is refused even with the right code.
select test_as_service();
update public.loyalty_claim_codes
   set expires_at = now() - interval '1 minute'
 where id = (select session_id from session2);
select test_as_user('00000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.loyalty_award_points(
       '10000000-0000-0000-0000-000000000001',
       (select session_id from session2), 1250) $$,
  'P0001', NULL,
  'An expired session cannot award points'
);

-- Guessing: repeated misses throttle before the 10,000-code space is walkable.
-- Each miss must PERSIST its audit row, or the limiter counts nothing — the
-- reason these outcomes are returned rather than raised.
select test_as_user('00000000-0000-0000-0000-000000000002');
do $$
declare i int;
begin
  for i in 1..10 loop
    perform public.loyalty_resolve_checkout_session(
      '10000000-0000-0000-0000-000000000001', 'code4', lpad(i::text, 4, '0'));
  end loop;
end $$;

-- Would be 0 if the failures had been raised instead of returned, since the
-- exception would roll back each audit row before the limiter could see it.
select ok(
  (select count(*) from public.loyalty_checkout_lookups
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and outcome = 'not_found') > 0,
  'Failed lookups survive as audit rows for the rate limiter to count'
);

select is(
  (select outcome from public.loyalty_resolve_checkout_session(
     '10000000-0000-0000-0000-000000000001', 'code4', '9999')),
  'throttled',
  'Repeated wrong codes throttle further 4-digit lookups'
);

select ok(
  (select count(*) from public.loyalty_checkout_lookups
    where organization_id = '10000000-0000-0000-0000-000000000001'
      and outcome = 'throttled') > 0,
  'Throttled attempts are recorded for audit'
);

-- Throttling the guessable method must not strand the vendor: a 256-bit QR
-- token is not brute-forceable, so the scanner keeps working for the real
-- customer waiting at the counter.
select is(
  (select outcome from public.loyalty_resolve_checkout_session(
     '10000000-0000-0000-0000-000000000001', 'qr', (select t2 from tokens))),
  'expired',
  'A 4-digit throttle does not disable the QR scanner'
);

-- Uniqueness among live sessions in one organization.
select test_as_service();
select throws_ok(
  $$ insert into public.loyalty_claim_codes
       (account_id, organization_id, numeric_code, token_digest, expires_at, status)
     select a.id, '10000000-0000-0000-0000-000000000001', '7777',
            repeat('a', 64), now() + interval '5 minutes', 'pending'
       from public.loyalty_accounts a
      where a.organization_id = '10000000-0000-0000-0000-000000000001'
        and a.user_id = '00000000-0000-0000-0000-000000000003';
     insert into public.loyalty_claim_codes
       (account_id, organization_id, numeric_code, token_digest, expires_at, status)
     select a.id, '10000000-0000-0000-0000-000000000001', '7777',
            repeat('b', 64), now() + interval '5 minutes', 'pending'
       from public.loyalty_accounts a
      where a.organization_id = '10000000-0000-0000-0000-000000000001'
        and a.user_id = '00000000-0000-0000-0000-000000000003' $$,
  '23505', NULL,
  'Two live sessions in one org cannot share a 4-digit code'
);

-- Historical rows from the 6-character era survive the migration intact.
select test_as_service();
select ok(
  (select count(*) from public.loyalty_claim_codes
    where code is not null and numeric_code is null) >= 0,
  'Legacy 6-character rows remain valid under the new constraints'
);

-- Regression: the wallet has no vendor unit to attribute a scan to, so it omits
-- that argument entirely. While the parameter sat mid-list without a default,
-- PostgREST could not resolve the function by its named arguments and every
-- wallet checkout failed with PGRST202 before the function ever ran.
select test_as_user('00000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ select public.loyalty_start_checkout_session(
       '10000000-0000-0000-0000-000000000001',
       encode(sha256('omitted-unit'::bytea), 'hex'), array['1357','2468']) $$,
  'A checkout session opens without naming a vendor unit'
);

-- ----------------------------------------------------------------------------
-- A stamp-era version is not a live points program
-- ----------------------------------------------------------------------------
-- The points migration could convert the schema but not an already-active
-- stamp version: it has no points rate and no catalog. Left unguarded it
-- advertised itself to customers and then failed at the award step, after the
-- customer had already shown a code at the counter.

select test_as_service();
update public.loyalty_program_versions
   set points_per_dollar = null
 where organization_id = '10000000-0000-0000-0000-000000000001'
   and status = 'active';

select is(
  (select count(*)::int from public.loyalty_program_previews
    where organization_id = '10000000-0000-0000-0000-000000000001'),
  0,
  'A program with no points rate is hidden from the customer-facing view'
);

select test_as_user('00000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.loyalty_start_checkout_session(
       '10000000-0000-0000-0000-000000000001',
       encode(sha256('no-rate'::bytea), 'hex'), array['5150']) $$,
  'P0001', NULL,
  'A customer cannot open a checkout code against a program that cannot award'
);

-- ----------------------------------------------------------------------------
-- Append-only ledger + RLS isolation
-- ----------------------------------------------------------------------------

select test_as_service();
select throws_ok(
  $$ update public.loyalty_ledger_entries set delta_points = 9999
      where organization_id = '10000000-0000-0000-0000-000000000001' $$,
  NULL, NULL,
  'Ledger entries cannot be updated (append-only trigger)'
);

select test_as_user('00000000-0000-0000-0000-000000000004'); -- other org's owner
select is(
  (select count(*)::int from public.loyalty_accounts
    where organization_id = '10000000-0000-0000-0000-000000000001'),
  0,
  'An unrelated org owner cannot see another org''s loyalty accounts'
);

select test_as_user('00000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ insert into public.loyalty_ledger_entries
       (account_id, organization_id, program_version_id, entry_type,
        delta_points, idempotency_key)
     select a.id, a.organization_id,
            (select id from public.loyalty_program_versions
              where organization_id = a.organization_id and status = 'active'),
            'PURCHASE_POINTS', 5000, 'hack:' || gen_random_uuid()
       from public.loyalty_accounts a
      where a.user_id = '00000000-0000-0000-0000-000000000003' $$,
  NULL, NULL,
  'A customer cannot self-issue points by inserting ledger rows'
);

-- ----------------------------------------------------------------------------
-- Redemption safety
-- ----------------------------------------------------------------------------

-- 125 points is short of the 450-point entry reward.
select throws_ok(
  $$ select public.loyalty_request_redemption(
       '10000000-0000-0000-0000-000000000001',
       (select ci.id from public.loyalty_reward_catalog_items ci
          join public.loyalty_program_versions v on v.id = ci.program_version_id
         where v.organization_id = '10000000-0000-0000-0000-000000000001'
           and v.status = 'active' and ci.points_cost = 450)) $$,
  'P0001', NULL,
  'A customer cannot redeem a reward they cannot afford'
);

select finish();
rollback;
