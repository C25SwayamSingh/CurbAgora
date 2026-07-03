-- ============================================================================
-- Account model: preferred UI mode (non-authoritative) replaces permanent
-- account_type for authorization. Vendor capability comes only from
-- organization_members; preferred_mode controls navigation only.
-- ============================================================================

create type public.preferred_mode as enum ('customer', 'vendor');

alter table public.profiles
  add column preferred_mode public.preferred_mode not null default 'customer';

comment on column public.profiles.preferred_mode is
  'Non-authoritative UI preference (customer vs vendor interface). Never '
  'grants vendor data access — organization_members does.';

comment on column public.profiles.account_type is
  'DEPRECATED — retained for safe migration only. Do not use for authorization. '
  'Clients cannot change this column; use preferred_mode for interface switching.';

-- Preserve existing choices where possible.
update public.profiles
set preferred_mode = case
  when account_type = 'vendor'::public.account_type then 'vendor'::public.preferred_mode
  else 'customer'::public.preferred_mode
end;

-- Users who completed customer onboarding keep complete status.
-- Vendor-path users without membership stay in_progress until org exists.
update public.profiles p
set onboarding_status = 'in_progress'
where p.account_type = 'vendor'::public.account_type
  and p.onboarding_status = 'complete'::public.onboarding_status
  and not exists (
    select 1
    from public.organization_members m
    where m.user_id = p.id
      and m.status = 'active'
  );

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
    -- account_type is deprecated; block client-side changes entirely.
    if new.account_type is distinct from old.account_type then
      raise exception 'account_type is deprecated and cannot be changed'
        using errcode = '42501';
    end if;
    -- preferred_mode is intentionally user-editable (UI navigation only).
  end if;
  return new;
end;
$$;

-- Organization creation: any authenticated user with aal2 may bootstrap a
-- tenant; vendor authorization is granted by the owner membership row, not
-- profile.account_type or preferred_mode.
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

  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'multi-factor authentication is required to create an organization'
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
  'for auth.uid(). Requires aal2. Vendor access is membership-based, not '
  'profile.account_type. DEFINER: bootstrap + RLS bypass.';
