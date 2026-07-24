-- ============================================================================
-- Loyalty checkout fixes: callable signature + no half-migrated programs
-- ============================================================================
-- Two defects found by a vendor testing the live flow.
--
-- 1. "Something went wrong" whenever a customer opened their code from the
--    /rewards wallet.
--
--    `p_vendor_unit_id` sat in the middle of the parameter list with no
--    default. The wallet has no unit to attribute the scan to, so it omitted
--    the argument — and PostgREST matches functions by their full named
--    argument set, so it found no candidate and returned PGRST202 before the
--    function ever ran. The unit-specific page worked only because it happened
--    to supply the argument.
--
--    Moving the parameter last and defaulting it to null makes both call
--    shapes resolve.
--
-- 2. "Earn null points per $1" on a vendor still carrying a stamp-era program.
--
--    The points migration converted the schema but could not convert an
--    already-active stamp version: it has no `points_per_dollar` and no reward
--    catalog. Nothing rejected it, so it advertised itself as a live program,
--    let customers open checkout codes against it, and then failed at the award
--    step — after the customer had already shown a code at the counter.
--
--    A program with no points rate cannot award points, so it is not a live
--    program. Both the customer-facing view and the session opener now say so
--    up front, which turns a confusing failure at the register into an honest
--    absence.
--
-- Forward-only. No rows deleted; the stamp-era version rows stay exactly as
-- they are for audit, they simply stop being treated as publishable programs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Re-declare with the optional argument last
-- ---------------------------------------------------------------------------

drop function if exists public.loyalty_start_checkout_session(uuid, uuid, text, text[]);

create function public.loyalty_start_checkout_session(
  p_organization_id uuid,
  p_token_digest text,
  p_code_candidates text[],
  p_vendor_unit_id uuid default null
) returns table (session_id uuid, numeric_code text, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id uuid;
  v_program public.loyalty_programs%rowtype;
  v_has_points boolean;
  v_code text;
  v_expires timestamptz;
  v_recent int;
  v_session_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid checkout token' using errcode = 'P0001';
  end if;
  if p_code_candidates is null or array_length(p_code_candidates, 1) is null then
    raise exception 'invalid checkout token' using errcode = 'P0001';
  end if;

  select * into v_program from public.loyalty_programs
   where organization_id = p_organization_id;
  if not found or v_program.earning_paused then
    raise exception 'this vendor is not currently awarding points'
      using errcode = 'P0001';
  end if;

  -- A version with no points rate is a stamp-era leftover. Refusing here means
  -- the customer learns at the wallet instead of at the counter.
  select exists (
    select 1 from public.loyalty_program_versions v
     where v.program_id = v_program.id
       and v.status = 'active'
       and v.points_per_dollar is not null
  ) into v_has_points;
  if not v_has_points then
    raise exception 'this vendor is not currently awarding points'
      using errcode = 'P0001';
  end if;

  -- The unit is only context; it must still belong to this organization.
  if p_vendor_unit_id is not null
     and not exists (select 1 from public.vendor_units u
                      where u.id = p_vendor_unit_id
                        and u.organization_id = p_organization_id) then
    p_vendor_unit_id := null;
  end if;

  insert into public.loyalty_accounts (organization_id, user_id)
  values (p_organization_id, auth.uid())
  on conflict (organization_id, user_id) do update set updated_at = now()
  returning id into v_account_id;

  select count(*) into v_recent
    from public.loyalty_claim_codes c
   where c.account_id = v_account_id
     and c.created_at > now() - interval '24 hours';
  if v_recent >= 30 then
    raise exception 'too many checkout codes created today; please try again later'
      using errcode = 'P0001';
  end if;

  -- One live session per account: opening a new one retires the old one, so a
  -- screenshot of a previous QR stops working immediately.
  update public.loyalty_claim_codes
     set status = 'cancelled', invalidated_reason = 'replaced'
   where account_id = v_account_id and status = 'pending';

  -- Expire anything stale in this org first, so a lingering row cannot hold a
  -- numeric code hostage. Aliased because `expires_at` is also an OUT
  -- parameter of this function, and plpgsql resolves the variable first.
  update public.loyalty_claim_codes c
     set status = 'expired', invalidated_reason = 'timed_out'
   where c.organization_id = p_organization_id
     and c.status = 'pending'
     and c.expires_at < now();

  select cand into v_code
    from unnest(p_code_candidates) as cand
   where cand ~ '^[0-9]{4}$'
     and not exists (
       select 1 from public.loyalty_claim_codes c
        where c.organization_id = p_organization_id
          and c.status = 'pending'
          and c.numeric_code = cand)
   limit 1;

  if v_code is null then
    raise exception 'too many people are checking out right now; try again in a moment'
      using errcode = 'P0001';
  end if;

  v_expires := now() + interval '5 minutes';

  insert into public.loyalty_claim_codes
    (account_id, organization_id, vendor_unit_id, numeric_code,
     token_digest, expires_at)
  values
    (v_account_id, p_organization_id, p_vendor_unit_id, v_code,
     p_token_digest, v_expires)
  returning id into v_session_id;

  return query select v_session_id, v_code, v_expires;
end;
$$;

revoke all on function public.loyalty_start_checkout_session(uuid, text, text[], uuid) from public;
grant execute on function public.loyalty_start_checkout_session(uuid, text, text[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A program without a points rate is not a live program
-- ---------------------------------------------------------------------------
-- The view is what the customer wallet and public profile read. Filtering here
-- removes "Earn null points per $1" at the source rather than teaching every
-- surface to special-case a null.

drop view if exists public.loyalty_program_previews;

create view public.loyalty_program_previews as
select
  p.organization_id,
  o.slug as organization_slug,
  o.display_name as organization_name,
  p.earning_paused,
  p.redemption_paused,
  v.id as program_version_id,
  v.points_per_dollar,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
        'id', ci.id,
        'points_cost', ci.points_cost,
        'reward_kind', ci.reward_kind,
        'reward_name', ci.reward_name,
        'reward_value_cents', ci.reward_value_cents
      ) order by ci.points_cost)
     from public.loyalty_reward_catalog_items ci
     where ci.program_version_id = v.id),
    '[]'::jsonb
  ) as catalog
from public.loyalty_programs p
join public.organizations o on o.id = p.organization_id
join public.loyalty_program_versions v
  on v.program_id = p.id and v.status = 'active'
where o.status = 'active'
  -- Stamp-era versions have no points rate; they cannot award and must not
  -- advertise themselves as a program a customer can join.
  and v.points_per_dollar is not null;

comment on view public.loyalty_program_previews is
  'Public, customer-safe view of an organization''s live points program. '
  'Excludes stamp-era versions that carry no points rate — those cannot award '
  'points, so surfacing them would promise something the ledger will refuse.';

grant select on public.loyalty_program_previews to anon, authenticated;
