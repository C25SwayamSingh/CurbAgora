-- pgTAP tests for team invitations.
--
-- The property that carries the security here is EMAIL BINDING: holding the
-- link is not enough, you must be signed in as the invited address. Most of
-- this file exists to prove a leaked or forwarded link is inert.
--
-- Covers: supabase/migrations/20260718000000_organization_invitations.sql
--
-- Fixture-scoped: all ids belong to this file's own fixtures.
begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@invite.test',   'x', now(), '{"provider":"email"}', '{"display_name":"Owner"}'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@invite.test', 'x', now(), '{"provider":"email"}', '{"display_name":"Manager"}'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@invite.test',   'x', now(), '{"provider":"email"}', '{"display_name":"Staff"}'),
  -- The invitee: signs up later, with no display name of their own.
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jose@invite.test',    'x', now(), '{"provider":"email"}', '{}'),
  -- Someone who got the link but is not who it was for.
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger@invite.test','x', now(), '{"provider":"email"}', '{}');

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

update public.profiles set display_name = '' where id = '00000000-0000-0000-0000-0000000000a4';

insert into public.organizations (id, legal_name, display_name, slug, created_by)
values ('20000000-0000-0000-0000-000000000001', 'Invite Cart LLC', 'Invite Cart', 'invite-cart',
        '00000000-0000-0000-0000-0000000000a1');

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'owner',   'active'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'manager', 'active'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 'staff',   'active');

-- Digests inlined rather than held in a temp table: a temp table created as
-- postgres is not readable by the `authenticated` role, and "permission denied
-- for table" is itself errcode 42501 — which would have let the authorization
-- tests below pass without ever reaching the function.

-- ----------------------------------------------------------------------------
-- Who may invite
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-0000000000a3'); -- staff
select throws_ok(
  $$ select public.organization_create_invitation(
       '20000000-0000-0000-0000-000000000001', 'x@invite.test', 'staff', 'X',
       encode(sha256('invite-one'::bytea), 'hex')) $$,
  '42501', NULL,
  'Staff cannot invite anyone'
);

select test_as_user('00000000-0000-0000-0000-0000000000a2'); -- manager
select throws_ok(
  $$ select public.organization_create_invitation(
       '20000000-0000-0000-0000-000000000001', 'x@invite.test', 'owner', 'X',
       encode(sha256('invite-one'::bytea), 'hex')) $$,
  '42501', NULL,
  'A manager cannot invite an owner'
);

select lives_ok(
  $$ select public.organization_create_invitation(
       '20000000-0000-0000-0000-000000000001', 'other@invite.test', 'staff', 'Other',
       encode(sha256('invite-three'::bytea), 'hex')) $$,
  'A manager can invite staff'
);

select test_as_user('00000000-0000-0000-0000-0000000000a1'); -- owner
select lives_ok(
  $$ select public.organization_create_invitation(
       '20000000-0000-0000-0000-000000000001', 'Jose@Invite.test', 'staff', 'Jose',
       encode(sha256('invite-one'::bytea), 'hex')) $$,
  'An owner can invite staff'
);

select is(
  (select email from public.organization_invitations
    where email = 'jose@invite.test'),
  'jose@invite.test',
  'The invited address is normalised to lowercase for comparison'
);

-- The digest is excluded from the column grant, so not even an owner of the
-- organization can read it back — the link exists only where they sent it.
select throws_ok(
  $$ select token_digest from public.organization_invitations
      where email = 'jose@invite.test' $$,
  '42501', NULL,
  'The invite token digest is unreadable even to the org owner'
);

select throws_ok(
  $$ select public.organization_create_invitation(
       '20000000-0000-0000-0000-000000000001', 'not-an-email', 'staff', 'X',
       encode(sha256('bad'::bytea), 'hex')) $$,
  'P0001', NULL,
  'A malformed email address is refused'
);

select throws_ok(
  $$ select public.organization_create_invitation(
       '20000000-0000-0000-0000-000000000001', 'named@invite.test', 'staff', '   ',
       encode(sha256('noname'::bytea), 'hex')) $$,
  'P0001', NULL,
  'A first name is required so the roster can name people'
);

select throws_ok(
  $$ select public.organization_create_invitation(
       '20000000-0000-0000-0000-000000000001', 'staff@invite.test', 'staff', 'Dup',
       encode(sha256('dup'::bytea), 'hex')) $$,
  'P0001', NULL,
  'Someone already on the team cannot be invited again'
);

-- ----------------------------------------------------------------------------
-- The link alone is not enough
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-0000000000a5'); -- stranger holding the link
select is(
  (select outcome from public.organization_invitation_preview(encode(sha256('invite-one'::bytea), 'hex'))),
  'wrong_account',
  'A leaked link tells the wrong account it is not for them'
);

select throws_ok(
  $$ select public.organization_accept_invitation(encode(sha256('invite-one'::bytea), 'hex')) $$,
  '42501', NULL,
  'A leaked link cannot be accepted by anyone but the invited address'
);

select is(
  (select count(*)::int from public.organization_members
    where organization_id = '20000000-0000-0000-0000-000000000001'
      and user_id = '00000000-0000-0000-0000-0000000000a5'),
  0,
  'The failed attempt created no membership'
);

-- A preview reveals the business and role, never the rest of the team.
select is(
  (select organization_name from public.organization_invitation_preview(
     encode(sha256('invite-one'::bytea), 'hex'))),
  'Invite Cart',
  'The preview names the business so the invitee knows what they are joining'
);

select is(
  (select count(*)::int from public.organization_invitations),
  0,
  'A stranger reads no invitations at all — not even their own'
);

-- ----------------------------------------------------------------------------
-- Accepting
-- ----------------------------------------------------------------------------

select test_as_user('00000000-0000-0000-0000-0000000000a4'); -- jose
select is(
  (select outcome from public.organization_invitation_preview(encode(sha256('invite-one'::bytea), 'hex'))),
  'ready',
  'The invited address sees a ready invitation'
);

select is(
  (select role::text from public.organization_accept_invitation(encode(sha256('invite-one'::bytea), 'hex'))),
  'staff',
  'Accepting returns the granted role'
);

select is(
  (select role::text from public.organization_members
    where organization_id = '20000000-0000-0000-0000-000000000001'
      and user_id = '00000000-0000-0000-0000-0000000000a4'),
  'staff',
  'Accepting creates an active membership at the invited role'
);

select is(
  (select display_name from public.profiles
    where id = '00000000-0000-0000-0000-0000000000a4'),
  'Jose',
  'The invited first name fills an empty profile so the roster reads as people'
);

-- Single use: the same link a second time.
select throws_ok(
  $$ select public.organization_accept_invitation(encode(sha256('invite-one'::bytea), 'hex')) $$,
  'P0001', NULL,
  'An accepted invitation cannot be used again'
);

-- ----------------------------------------------------------------------------
-- Expiry and revocation
-- ----------------------------------------------------------------------------

select test_as_service();
insert into public.organization_invitations
  (organization_id, email, role, first_name, token_digest, invited_by, expires_at)
values
  ('20000000-0000-0000-0000-000000000001', 'stranger@invite.test', 'staff', 'Late',
   encode(sha256('invite-two'::bytea), 'hex'), '00000000-0000-0000-0000-0000000000a1', now() - interval '1 day');

select test_as_user('00000000-0000-0000-0000-0000000000a5');
select is(
  (select outcome from public.organization_invitation_preview(encode(sha256('invite-two'::bytea), 'hex'))),
  'expired',
  'An invitation past its expiry says so'
);

select throws_ok(
  $$ select public.organization_accept_invitation(encode(sha256('invite-two'::bytea), 'hex')) $$,
  'P0001', NULL,
  'An expired invitation cannot be accepted even by the right address'
);

select test_as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ select public.organization_revoke_invitation(
       (select id from public.organization_invitations
         where email = 'other@invite.test')) $$,
  'An owner can cancel a pending invitation'
);

select is(
  (select status from public.organization_invitations
    where email = 'other@invite.test'),
  'revoked',
  'A cancelled link stops working before it is ever used'
);

select finish();
rollback;
