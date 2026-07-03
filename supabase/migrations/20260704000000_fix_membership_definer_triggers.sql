-- ============================================================================
-- Fix membership protection triggers under SECURITY DEFINER.
--
-- Root cause: protect_membership_update/delete are SECURITY DEFINER (required
-- to count owners org-wide). Inside DEFINER functions, current_user is the
-- function owner (postgres), not the calling role (authenticated). The guard
--
--   if current_user in ('anon', 'authenticated')
--
-- therefore never ran for API clients, allowing self role changes and final-
-- owner removal.
--
-- Fix: gate on the session role (set by Supabase / test harness via SET ROLE),
-- which remains 'authenticated' or 'anon' for client requests.
-- ============================================================================

create or replace function public.protect_membership_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), 'none')
     in ('anon', 'authenticated') then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.organization_id is distinct from old.organization_id
       or new.created_at is distinct from old.created_at
       or new.invited_by is distinct from old.invited_by then
      raise exception 'protected membership fields cannot be changed'
        using errcode = '42501';
    end if;

    if old.user_id = auth.uid() and new.role is distinct from old.role then
      raise exception 'you cannot change your own role'
        using errcode = '42501';
    end if;

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
  'demotion. DEFINER: counts owners org-wide. Uses session role (not '
  'current_user) so protections apply under SECURITY DEFINER.';

create or replace function public.protect_membership_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), 'none')
     in ('anon', 'authenticated') then
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
  'Blocks deletion of the final active owner. DEFINER: counts owners '
  'org-wide. Uses session role (not current_user) so protections apply '
  'under SECURITY DEFINER.';
