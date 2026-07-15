-- ============================================================================
-- Organization creation no longer requires aal2. Vendor signup friction was
-- too high: owners/managers had to complete TOTP enrollment + verification
-- before they could even create their business. MFA becomes an optional,
-- suggested action offered from the dashboard after the org exists
-- (see /account/security), not a precondition for creating it.
--
-- What changes: only the aal2 check inside create_organization_with_owner().
-- Auth is still required (auth.uid() is not null); input validation is
-- unchanged. Any authenticated user with a confirmed email may now call this
-- function at aal1.
--
-- What stays untouched (Gate B — sensitive org/member management writes
-- remain mandatory-aal2, unaffected by this migration):
--   * organizations_update_requires_mfa (restrictive UPDATE policy)
--   * organization_members_insert_requires_mfa
--   * organization_members_update_requires_mfa
--   * organization_members_delete_requires_mfa
--   * mfa_assurance_ok() itself
--   * requireVendorSensitiveAction() in src/lib/auth/guards.ts
-- These policies never applied to org creation in the first place — this
-- function is SECURITY DEFINER and bypasses RLS entirely, which is exactly
-- why the (now-removed) aal2 check had to live inside the function body
-- rather than in a policy.
-- ============================================================================

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

  insert into public.organizations (legal_name, display_name, slug, created_by)
  values (trim(p_legal_name), trim(p_display_name), p_slug, v_user)
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role, status, invited_by)
  values (v_org.id, v_user, 'owner', 'active', null);

  return v_org;
end;
$$;

comment on function public.create_organization_with_owner(text, text, text) is
  'Atomically creates an organization plus its initial active owner membership '
  'for auth.uid(). No AAL requirement — MFA is optional and suggested after '
  'creation, not a precondition. Vendor access is membership-based, not '
  'profile.account_type. DEFINER: bootstrap + RLS bypass.';
