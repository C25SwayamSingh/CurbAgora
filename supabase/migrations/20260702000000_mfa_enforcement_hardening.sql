-- ============================================================================
-- Phase 2 hardening: mandatory MFA (AAL2) for organization owners/managers
-- and platform admins, enforced independently at the database level.
--
-- Prior behavior (20260701000000_auth_tenancy_foundation.sql):
--   `mfa_assurance_ok()` returned true whenever the caller had NOT yet
--   enrolled a verified MFA factor — i.e. MFA was only enforced "once you
--   opt in". `create_organization_with_owner()` had no AAL check at all
--   (as SECURITY DEFINER it also bypasses the restrictive RLS policies that
--   referenced `mfa_assurance_ok()`, so org creation was never gated by
--   MFA in any way).
--
-- This migration makes MFA mandatory (not optional) for organization
-- owners/managers and unconditionally required for platform admins, and
-- closes the SECURITY DEFINER bypass:
--   * `mfa_assurance_ok()` now requires aal2 unconditionally (no more
--     "or no factor enrolled" escape hatch). It continues to gate the
--     restrictive policies on organizations/organization_members writes,
--     which are only reachable by owners/managers in the first place, so
--     this makes MFA truly mandatory for those roles at the DB layer,
--     independent of any client/app behavior.
--   * `is_platform_admin()` now also requires aal2. Every policy that uses
--     it (profiles, organizations, organization_members reads) therefore
--     stops recognizing an admin's own elevated access until their session
--     is MFA-verified, with zero additional policy changes required.
--   * `create_organization_with_owner()` independently checks aal2 before
--     doing anything else, closing the SECURITY DEFINER RLS-bypass gap:
--     initial organization (+ owner membership) creation cannot happen
--     from an aal1 session even though the function runs with elevated
--     privileges.
-- No custom, client-writable MFA flag is introduced anywhere: every check
-- reads `auth.jwt() ->> 'aal'`, which only Supabase Auth's own TOTP
-- challenge/verify flow can set to 'aal2'.
-- ============================================================================

create or replace function public.mfa_assurance_ok()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

comment on function public.mfa_assurance_ok() is
  'True only for an aal2 (MFA-verified) session. Gates restrictive policies '
  'on organization/membership writes, which only owners/managers can reach '
  '(has_org_role checks in the permissive policies) — MFA is therefore '
  'mandatory for those roles, not merely "if enrolled". DEFINER: reads the '
  'JWT claim via a stable wrapper used inside policies.';

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     and exists (
        select 1
        from public.platform_admins pa
        where pa.user_id = auth.uid()
      );
$$;

comment on function public.is_platform_admin() is
  'True when the requesting user (auth.uid()) is a platform admin AND the '
  'session is aal2 (MFA-verified). Every RLS policy using this function '
  'therefore requires AAL2 for admin-level access with no extra policy '
  'changes. DEFINER: reads platform_admins regardless of caller grants.';

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

  -- Mandatory MFA for organization owners: checked here explicitly because
  -- this function is SECURITY DEFINER and therefore bypasses the
  -- restrictive RLS policies on organizations/organization_members
  -- entirely. Without this check, org (+ initial owner) creation could
  -- never be gated by MFA no matter how the RLS policies were written.
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'multi-factor authentication is required to create an organization'
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
  'membership for auth.uid(). Requires an aal2 (MFA-verified) session — '
  'DEFINER: RLS cannot express tenant bootstrap and would not gate this '
  'function anyway, so the AAL check is explicit here.';
