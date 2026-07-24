-- ============================================================================
-- Team invitations
-- ============================================================================
-- An owner or manager invites someone by email and gets back a single-use
-- link, which they send however they already talk to that person — text,
-- WhatsApp, in person. CurbAgora sends no mail, which keeps the deployment
-- free of a service-role key.
--
-- A membership row cannot be created ahead of time: organization_members
-- .user_id references auth.users, and an invited person may not have an
-- account yet. Hence a separate record keyed by email, converted to a
-- membership at the moment they accept.
--
-- What actually makes this safe is NOT that the invitee logs in. It is:
--
--   * the token is bound to the invited email — accepting requires being
--     signed in AS that address, so a forwarded or leaked link is inert;
--   * only the token's digest is stored, so database access does not yield a
--     usable link;
--   * it expires, and is consumed on first use;
--   * a manager cannot mint an owner;
--   * the inviter is recorded, and the invite can be revoked before use.
--
-- The typo case is the realistic threat — sending staff access to
-- jose@gmial.com hands a stranger the ability to award points, which is
-- spending the vendor's food. Expiry plus revocation plus email binding is
-- what contains it.
-- ============================================================================

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Stored lowercase and trimmed; compared the same way on accept.
  email text not null,
  role public.organization_role not null default 'staff',
  -- Collected up front so the roster reads as people rather than rows the
  -- moment they join, without asking them to fill in a profile first.
  first_name text not null,
  token_digest text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint organization_invitations_email_format
    check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint organization_invitations_email_lowercase
    check (email = lower(email)),
  constraint organization_invitations_first_name_length
    check (char_length(trim(first_name)) between 1 and 60),
  constraint organization_invitations_token_digest_format
    check (token_digest ~ '^[0-9a-f]{64}$')
);

-- One live invitation per person per organization: re-inviting replaces
-- rather than accumulating links that all still work.
create unique index if not exists organization_invitations_one_pending
  on public.organization_invitations (organization_id, email)
  where status = 'pending';

create unique index if not exists organization_invitations_token_digest_key
  on public.organization_invitations (token_digest);

create index if not exists organization_invitations_org_idx
  on public.organization_invitations (organization_id, status);

comment on table public.organization_invitations is
  'Pending team invitations, keyed by email because the invitee may not have '
  'an account yet. Only the invite token''s SHA-256 digest is stored — the '
  'link itself exists only in the owner''s hands.';

alter table public.organization_invitations enable row level security;

-- Owners and managers see their org's invitations. The invitee does not read
-- this table at all; they present a token to a function instead, so nothing
-- here leaks who else has been invited.
drop policy if exists "organization_invitations_select_leadership"
  on public.organization_invitations;
create policy "organization_invitations_select_leadership"
  on public.organization_invitations for select to authenticated
  using (
    public.has_org_role(
      organization_id,
      array['owner','manager']::public.organization_role[]
    )
    or public.is_platform_admin()
  );

-- Select only, and never the digest: every write goes through the functions
-- below so the role rules cannot be bypassed by a direct insert.
revoke all on public.organization_invitations from authenticated;
grant select (
  id, organization_id, email, role, first_name, status,
  invited_by, expires_at, accepted_at, accepted_by, created_at
) on public.organization_invitations to authenticated;

-- ---------------------------------------------------------------------------
-- Create
-- ---------------------------------------------------------------------------

create or replace function public.organization_create_invitation(
  p_organization_id uuid,
  p_email text,
  p_role public.organization_role,
  p_first_name text,
  p_token_digest text
) returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_name text := trim(p_first_name);
  v_expires timestamptz;
  v_id uuid;
  v_is_owner boolean;
begin
  v_is_owner := public.has_org_role(
    p_organization_id, array['owner']::public.organization_role[]);

  if not v_is_owner and not public.has_org_role(
       p_organization_id, array['manager']::public.organization_role[]) then
    raise exception 'only owners and managers can invite people'
      using errcode = '42501';
  end if;

  -- Mirrors the membership insert policy: a manager must not be able to
  -- create someone with authority over themselves.
  if p_role = 'owner' and not v_is_owner then
    raise exception 'only an owner can invite another owner'
      using errcode = '42501';
  end if;

  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that email address does not look right'
      using errcode = 'P0001';
  end if;
  if char_length(v_name) < 1 then
    raise exception 'add a first name so your team can tell who is who'
      using errcode = 'P0001';
  end if;
  if p_token_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid invitation token' using errcode = 'P0001';
  end if;

  -- Already on the team: re-inviting would create a second membership.
  if exists (
    select 1
      from public.organization_members m
      join auth.users u on u.id = m.user_id
     where m.organization_id = p_organization_id
       and m.status = 'active'
       and lower(u.email) = v_email
  ) then
    raise exception 'that person is already on your team'
      using errcode = 'P0001';
  end if;

  -- Replacing a live invite retires the old link rather than leaving two
  -- valid ways in.
  update public.organization_invitations
     set status = 'revoked'
   where organization_id = p_organization_id
     and email = v_email
     and status = 'pending';

  v_expires := now() + interval '7 days';

  insert into public.organization_invitations
    (organization_id, email, role, first_name, token_digest,
     invited_by, expires_at)
  values
    (p_organization_id, v_email, p_role, v_name, p_token_digest,
     auth.uid(), v_expires)
  returning id into v_id;

  return query select v_id, v_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- Preview (what the invitee sees before deciding)
-- ---------------------------------------------------------------------------
-- Deliberately reveals only the organization name, the role, and whether the
-- signed-in account matches. Someone holding a link for the wrong address
-- learns nothing about who else is on the team.

create or replace function public.organization_invitation_preview(
  p_token_digest text
) returns table (
  outcome text,
  organization_name text,
  role public.organization_role,
  first_name text,
  invited_email text,
  expires_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_inv public.organization_invitations%rowtype;
  v_org_name text;
  v_user_email text;
begin
  select * into v_inv from public.organization_invitations i
   where i.token_digest = p_token_digest;

  if not found then
    return query select 'not_found'::text, null::text,
                        null::public.organization_role, null::text,
                        null::text, null::timestamptz;
    return;
  end if;

  select o.display_name into v_org_name
    from public.organizations o where o.id = v_inv.organization_id;

  if v_inv.status = 'accepted' then
    return query select 'already_accepted'::text, v_org_name, v_inv.role,
                        v_inv.first_name, v_inv.email, v_inv.expires_at;
    return;
  end if;
  if v_inv.status <> 'pending' then
    return query select 'revoked'::text, v_org_name, v_inv.role,
                        v_inv.first_name, v_inv.email, v_inv.expires_at;
    return;
  end if;
  if v_inv.expires_at < now() then
    return query select 'expired'::text, v_org_name, v_inv.role,
                        v_inv.first_name, v_inv.email, v_inv.expires_at;
    return;
  end if;

  select lower(u.email) into v_user_email
    from auth.users u where u.id = auth.uid();

  -- The binding that makes a leaked link useless.
  if auth.uid() is null then
    return query select 'sign_in_required'::text, v_org_name, v_inv.role,
                        v_inv.first_name, v_inv.email, v_inv.expires_at;
    return;
  end if;
  if v_user_email is distinct from v_inv.email then
    return query select 'wrong_account'::text, v_org_name, v_inv.role,
                        v_inv.first_name, v_inv.email, v_inv.expires_at;
    return;
  end if;

  return query select 'ready'::text, v_org_name, v_inv.role,
                      v_inv.first_name, v_inv.email, v_inv.expires_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Accept
-- ---------------------------------------------------------------------------

create or replace function public.organization_accept_invitation(
  p_token_digest text
) returns table (organization_id uuid, role public.organization_role)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_inv public.organization_invitations%rowtype;
  v_user_email text;
begin
  if auth.uid() is null then
    raise exception 'sign in to accept this invitation' using errcode = '42501';
  end if;

  -- Locked for the duration: two taps on the link must not create two
  -- memberships.
  select * into v_inv from public.organization_invitations i
   where i.token_digest = p_token_digest
   for update;
  if not found then
    raise exception 'this invitation link is not valid' using errcode = 'P0001';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'this invitation has already been used or was cancelled'
      using errcode = 'P0001';
  end if;
  if v_inv.expires_at < now() then
    update public.organization_invitations
       set status = 'expired' where id = v_inv.id;
    raise exception 'this invitation has expired — ask for a new link'
      using errcode = 'P0001';
  end if;

  select lower(u.email) into v_user_email
    from auth.users u where u.id = auth.uid();
  if v_user_email is distinct from v_inv.email then
    raise exception 'this invitation was sent to a different email address'
      using errcode = '42501';
  end if;

  -- Idempotent against an existing membership (re-invited after revoke).
  -- Aliased in the WHERE clauses because `organization_id` and `role` are also
  -- OUT parameters of this function, and plpgsql resolves the variable first.
  insert into public.organization_members
    (organization_id, user_id, role, status, invited_by)
  values
    (v_inv.organization_id, auth.uid(), v_inv.role, 'active', v_inv.invited_by)
  on conflict do nothing;

  update public.organization_members m
     set role = v_inv.role, status = 'active'
   where m.organization_id = v_inv.organization_id
     and m.user_id = auth.uid();

  -- Give the roster a name immediately, without overwriting one they chose.
  update public.profiles
     set display_name = v_inv.first_name
   where id = auth.uid()
     and trim(coalesce(display_name, '')) = '';

  update public.organization_invitations
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = v_inv.id;

  return query select v_inv.organization_id, v_inv.role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Revoke
-- ---------------------------------------------------------------------------

create or replace function public.organization_revoke_invitation(
  p_invitation_id uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
    from public.organization_invitations where id = p_invitation_id;
  if v_org is null then
    raise exception 'invitation not found' using errcode = 'P0001';
  end if;
  if not public.has_org_role(
       v_org, array['owner','manager']::public.organization_role[]) then
    raise exception 'only owners and managers can cancel invitations'
      using errcode = '42501';
  end if;
  update public.organization_invitations
     set status = 'revoked'
   where id = p_invitation_id and status = 'pending';
end;
$$;

revoke all on function public.organization_create_invitation(uuid, text, public.organization_role, text, text) from public;
revoke all on function public.organization_invitation_preview(text) from public;
revoke all on function public.organization_accept_invitation(text) from public;
revoke all on function public.organization_revoke_invitation(uuid) from public;

grant execute on function public.organization_create_invitation(uuid, text, public.organization_role, text, text) to authenticated;
-- anon may preview: a signed-out person opening the link must be told to sign
-- in, which requires knowing the invitation exists.
grant execute on function public.organization_invitation_preview(text) to anon, authenticated;
grant execute on function public.organization_accept_invitation(text) to authenticated;
grant execute on function public.organization_revoke_invitation(uuid) to authenticated;
