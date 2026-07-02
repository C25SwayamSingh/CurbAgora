-- ============================================================================
-- Phase 2: Authentication & Tenancy Foundation
--
-- Creates: profiles, organizations, organization_members, platform_admins
-- Security posture:
--   * RLS enabled on every table (default deny: no policy => no access).
--   * Platform admin status lives in a dedicated table that has NO insert/
--     update/delete policies and revoked write grants — it can only be
--     written via migrations or the service role key (never from the client,
--     never derived from profile fields or user-editable auth metadata).
--   * All SECURITY DEFINER functions pin search_path = public, pg_temp and
--     validate auth.uid(); each carries a comment explaining why DEFINER is
--     required.
--   * Authorization-relevant columns are protected by triggers so clients
--     cannot mass-assign them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enumerated types
-- ----------------------------------------------------------------------------

create type public.account_type as enum ('customer', 'vendor');

create type public.onboarding_status as enum (
  'not_started',
  'in_progress',
  'complete'
);

create type public.organization_status as enum (
  'active',
  'suspended',
  'archived'
);

create type public.organization_role as enum ('owner', 'manager', 'staff');

create type public.membership_status as enum ('invited', 'active', 'revoked');

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  account_type public.account_type,
  onboarding_status public.onboarding_status not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) <= 120),
  constraint profiles_avatar_url_length check (char_length(avatar_url) <= 2048)
);

comment on table public.profiles is
  'App profile per auth user. Never stores auth secrets. account_type is a '
  'one-time choice protected by trigger; platform admin status is NOT stored '
  'here (see platform_admins).';

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  display_name text not null,
  slug text not null unique,
  status public.organization_status not null default 'active',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_legal_name_length check (char_length(legal_name) between 2 and 200),
  constraint organizations_display_name_length check (char_length(display_name) between 2 and 120),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46})[a-z0-9]$')
);

comment on table public.organizations is
  'Vendor organizations (tenants). Created only via '
  'create_organization_with_owner() so an org can never exist without an owner.';

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.organization_role not null default 'staff',
  status public.membership_status not null default 'invited',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organization_members is
  'Org membership + role. Duplicate non-revoked memberships per (org, user) '
  'are prevented by a partial unique index; final-owner and self-role-change '
  'protections are enforced by triggers.';

-- Prevent duplicate live memberships (invited or active) per org/user.
create unique index organization_members_unique_live_membership
  on public.organization_members (organization_id, user_id)
  where status <> 'revoked';

create index organization_members_org_idx on public.organization_members (organization_id);
create index organization_members_user_idx on public.organization_members (user_id);
create index organizations_created_by_idx on public.organizations (created_by);

-- Platform-level administration.
-- DESIGN DECISION (documented per security spec): platform admin status lives
-- in this dedicated table rather than in profiles or user-editable auth
-- metadata. Rows can only be written via migrations or the service-role key:
-- there are no INSERT/UPDATE/DELETE policies and write grants are revoked
-- below, so no authenticated user can ever self-assign a platform role.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Platform administrators. Writable only via migrations/service role; '
  'default-deny RLS with a self-read policy only.';

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Profile bootstrap: create a profile row for every new auth user.
-- SECURITY DEFINER is required because the trigger fires as the internal
-- supabase_auth_admin role, which has no direct privileges on public.profiles.
-- search_path is pinned to prevent object-shadowing attacks.
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Authorization helper functions.
-- All are SECURITY DEFINER for two reasons, both documented per the security
-- spec:
--   1. They are referenced inside RLS policies on organization_members; a
--      SECURITY INVOKER function would re-enter those same policies and cause
--      infinite RLS recursion.
--   2. platform_admins / auth.mfa_factors are not directly readable by the
--      calling role.
-- Every function pins search_path and keys all decisions off auth.uid() —
-- they never accept a trusted user id, role, or org id claim from the client
-- beyond the target org being checked.
-- ----------------------------------------------------------------------------

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
$$;

comment on function public.is_platform_admin() is
  'True when the requesting user (auth.uid()) is a platform admin. DEFINER: '
  'reads platform_admins regardless of caller grants; used inside policies.';

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

comment on function public.is_org_member(uuid) is
  'True when auth.uid() has an active membership in target_org. DEFINER: '
  'avoids RLS recursion when used inside organization_members policies.';

create or replace function public.has_org_role(
  target_org uuid,
  allowed_roles public.organization_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any (allowed_roles)
  );
$$;

comment on function public.has_org_role(uuid, public.organization_role[]) is
  'True when auth.uid() holds one of allowed_roles (active) in target_org. '
  'DEFINER: avoids RLS recursion in organization_members policies.';

create or replace function public.shares_active_org(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on mine.organization_id = theirs.organization_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = target_user
      and theirs.status = 'active'
  );
$$;

comment on function public.shares_active_org(uuid) is
  'True when auth.uid() and target_user share an active org membership. Used '
  'so org members can see co-member display names. DEFINER: avoids RLS '
  'recursion via organization_members.';

-- "Require MFA when enrolled": true when the session is aal2, or when the
-- user has no verified MFA factor yet. Used as a RESTRICTIVE policy on
-- sensitive vendor write operations so that once a vendor owner/manager
-- enrolls in MFA, plain-password (aal1) sessions can no longer perform them.
create or replace function public.mfa_assurance_ok()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1
        from auth.mfa_factors f
        where f.user_id = auth.uid()
          and f.status = 'verified'
      );
$$;

comment on function public.mfa_assurance_ok() is
  'aal2 session, or user has no verified MFA factor. DEFINER: reads '
  'auth.mfa_factors which callers cannot query directly.';

-- ----------------------------------------------------------------------------
-- Atomic organization + initial owner creation.
-- SECURITY DEFINER is required because (a) both inserts must happen in one
-- transaction so an ownerless org can never exist, and (b) plain RLS cannot
-- express the bootstrap step (you cannot be an org member before the org
-- exists). There is intentionally NO insert policy on organizations or
-- self-insert policy on organization_members — this function is the only
-- authenticated path to create a tenant.
-- ----------------------------------------------------------------------------

create or replace function public.create_organization_with_owner(
  p_legal_name text,
  p_display_name text,
  p_slug text
)
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_org public.organizations;
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  -- Server-side validation; never trust client input.
  if p_slug is null or p_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,46})[a-z0-9]$' then
    raise exception 'invalid organization slug'
      using errcode = '23514';
  end if;
  if p_legal_name is null or char_length(trim(p_legal_name)) not between 2 and 200 then
    raise exception 'invalid legal name'
      using errcode = '23514';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 2 and 120 then
    raise exception 'invalid display name'
      using errcode = '23514';
  end if;

  -- Only vendor accounts may create organizations. The account type comes
  -- from the caller's own protected profile row, never from client input.
  if not exists (
    select 1
    from public.profiles p
    where p.id = v_user
      and p.account_type = 'vendor'
  ) then
    raise exception 'a vendor account is required to create an organization'
      using errcode = '42501';
  end if;

  insert into public.organizations (legal_name, display_name, slug, created_by)
  values (trim(p_legal_name), trim(p_display_name), p_slug, v_user)
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role, status, invited_by)
  values (v_org.id, v_user, 'owner', 'active', null);

  return v_org;
end;
$$;

comment on function public.create_organization_with_owner(text, text, text) is
  'Atomically creates an organization plus its initial active owner '
  'membership for auth.uid(). DEFINER: RLS cannot express tenant bootstrap; '
  'this is the only client-reachable creation path.';

-- ----------------------------------------------------------------------------
-- Column / row protection triggers.
-- Gated on current_user in ('anon','authenticated') so migrations and the
-- service role can still repair data, while end users (whatever API path
-- they take) cannot touch protected authorization fields.
-- ----------------------------------------------------------------------------

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.id is distinct from old.id then
      raise exception 'profile id cannot be changed' using errcode = '42501';
    end if;
    if new.created_at is distinct from old.created_at then
      raise exception 'created_at cannot be changed' using errcode = '42501';
    end if;
    -- account_type is a one-time onboarding choice; changing it afterwards
    -- would let a customer grant themselves vendor capabilities.
    if old.account_type is not null
       and new.account_type is distinct from old.account_type then
      raise exception 'account type cannot be changed after onboarding'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

create or replace function public.protect_organization_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.id is distinct from old.id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'protected organization fields cannot be changed'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger organizations_protect_fields
  before update on public.organizations
  for each row execute function public.protect_organization_fields();

-- SECURITY DEFINER is required on the membership guards: they must count
-- owner rows across the whole org (bypassing the caller''s RLS view) to make
-- the final-owner check accurate for every caller.
create or replace function public.protect_membership_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.organization_id is distinct from old.organization_id
       or new.created_at is distinct from old.created_at
       or new.invited_by is distinct from old.invited_by then
      raise exception 'protected membership fields cannot be changed'
        using errcode = '42501';
    end if;

    -- No member may alter their own role (prevents self-escalation and
    -- accidental self-demotion; ownership transfer = promote someone else
    -- to owner, then the new owner demotes/removes you).
    if old.user_id = auth.uid() and new.role is distinct from old.role then
      raise exception 'you cannot change your own role'
        using errcode = '42501';
    end if;

    -- Final-owner protection: an org can never lose its last active owner.
    if old.role = 'owner' and old.status = 'active'
       and (new.role <> 'owner' or new.status <> 'active') then
      if not exists (
        select 1
        from public.organization_members m
        where m.organization_id = old.organization_id
          and m.role = 'owner'
          and m.status = 'active'
          and m.id <> old.id
      ) then
        raise exception 'cannot demote or deactivate the final owner; transfer ownership first'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.protect_membership_update() is
  'Blocks self role changes, protected-field edits, and final-owner '
  'demotion. DEFINER: must count owners org-wide regardless of caller RLS.';

create trigger organization_members_protect_update
  before update on public.organization_members
  for each row execute function public.protect_membership_update();

create or replace function public.protect_membership_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if old.role = 'owner' and old.status = 'active' then
      if not exists (
        select 1
        from public.organization_members m
        where m.organization_id = old.organization_id
          and m.role = 'owner'
          and m.status = 'active'
          and m.id <> old.id
      ) then
        raise exception 'cannot remove the final owner; transfer ownership first'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return old;
end;
$$;

comment on function public.protect_membership_delete() is
  'Blocks removal of the final active owner. DEFINER: must count owners '
  'org-wide regardless of caller RLS.';

create trigger organization_members_protect_delete
  before delete on public.organization_members
  for each row execute function public.protect_membership_delete();

-- ----------------------------------------------------------------------------
-- Row Level Security — enabled on every table; no policy => denied.
-- ----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.platform_admins enable row level security;

-- ---- profiles ----
-- Read: own profile; co-members of an active shared org (display names in
-- member lists); platform admins. Anonymous users get nothing — no private
-- identity info is ever exposed publicly.
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles_select_shared_org"
  on public.profiles for select to authenticated
  using (public.shares_active_org(id));

create policy "profiles_select_platform_admin"
  on public.profiles for select to authenticated
  using (public.is_platform_admin());

-- Update: own row only. Protected authorization fields (id, account_type
-- after it is set, created_at) are enforced by the profiles_protect_fields
-- trigger. No INSERT policy (rows come from the auth.users trigger) and no
-- DELETE policy (rows follow auth.users lifecycle).
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---- organizations ----
-- Read: active members of the org (owner/manager/staff) and platform admins.
create policy "organizations_select_member"
  on public.organizations for select to authenticated
  using (public.is_org_member(id) or public.is_platform_admin());

-- Update: owners only. No INSERT policy — creation must go through
-- create_organization_with_owner(). No DELETE policy this phase (archive via
-- status instead).
create policy "organizations_update_owner"
  on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner']::public.organization_role[]))
  with check (public.has_org_role(id, array['owner']::public.organization_role[]));

-- Sensitive vendor operation: once the user has a verified MFA factor,
-- org updates require an aal2 (MFA-verified) session.
create policy "organizations_update_requires_mfa"
  on public.organizations as restrictive for update to authenticated
  using (public.mfa_assurance_ok());

-- ---- organization_members ----
-- Read: your own memberships; owners/managers see the whole org roster;
-- platform admins see all. Staff therefore see only their own row.
create policy "organization_members_select"
  on public.organization_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_org_role(organization_id, array['owner','manager']::public.organization_role[])
    or public.is_platform_admin()
  );

-- Insert: owners may add any role; managers may add manager/staff but never
-- owner. Nobody may insert a row for themselves (the only self-owner path is
-- create_organization_with_owner), and invited_by must be the acting user —
-- both block mass assignment of authorization values from the client.
create policy "organization_members_insert"
  on public.organization_members for insert to authenticated
  with check (
    user_id <> (select auth.uid())
    and invited_by = (select auth.uid())
    and (
      public.has_org_role(organization_id, array['owner']::public.organization_role[])
      or (
        public.has_org_role(organization_id, array['manager']::public.organization_role[])
        and role <> 'owner'
      )
    )
  );

-- Update: owners manage all rows; managers manage non-owner rows and cannot
-- set role = owner. Triggers additionally block self-role changes and
-- final-owner demotion.
create policy "organization_members_update"
  on public.organization_members for update to authenticated
  using (
    public.has_org_role(organization_id, array['owner']::public.organization_role[])
    or (
      public.has_org_role(organization_id, array['manager']::public.organization_role[])
      and role <> 'owner'
    )
  )
  with check (
    public.has_org_role(organization_id, array['owner']::public.organization_role[])
    or (
      public.has_org_role(organization_id, array['manager']::public.organization_role[])
      and role <> 'owner'
    )
  );

-- Delete: owners remove anyone (final-owner trigger still applies); managers
-- remove staff only; any member may leave (delete own row) unless they are
-- the final owner.
create policy "organization_members_delete"
  on public.organization_members for delete to authenticated
  using (
    public.has_org_role(organization_id, array['owner']::public.organization_role[])
    or (
      public.has_org_role(organization_id, array['manager']::public.organization_role[])
      and role = 'staff'
      and user_id <> (select auth.uid())
    )
    or user_id = (select auth.uid())
  );

-- Membership changes are sensitive vendor operations: require aal2 once the
-- acting user has a verified MFA factor.
create policy "organization_members_insert_requires_mfa"
  on public.organization_members as restrictive for insert to authenticated
  with check (public.mfa_assurance_ok());

create policy "organization_members_update_requires_mfa"
  on public.organization_members as restrictive for update to authenticated
  using (public.mfa_assurance_ok());

create policy "organization_members_delete_requires_mfa"
  on public.organization_members as restrictive for delete to authenticated
  using (public.mfa_assurance_ok());

-- ---- platform_admins ----
-- Read: users may check their own admin status. No write policies exist and
-- write grants are revoked below: platform roles can never be self-assigned.
create policy "platform_admins_select_self"
  on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Grants (defense in depth on top of RLS)
-- ----------------------------------------------------------------------------

revoke all on public.profiles from anon;
revoke all on public.organizations from anon;
revoke all on public.organization_members from anon;
revoke all on public.platform_admins from anon;
revoke insert, update, delete on public.platform_admins from authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke insert, delete on public.organizations from authenticated;

revoke execute on function public.create_organization_with_owner(text, text, text) from anon, public;
grant execute on function public.create_organization_with_owner(text, text, text) to authenticated;
