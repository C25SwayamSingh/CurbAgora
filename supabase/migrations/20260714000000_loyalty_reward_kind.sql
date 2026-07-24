-- Loyalty: explicit reward kinds.
--
-- The original model assumed every reward was a free menu item, which has
-- cost leverage (a $3.50 drink may cost the vendor $0.90). A fixed discount
-- has none: $5 off costs $5 of foregone revenue. Treating a discount as a
-- free item understated vendor cost, so reward kind is now explicit and the
-- server-side cost cap is computed per kind.
--
-- Forward-only and additive: existing rows default to FREE_ITEM, which is
-- exactly how they were already being modeled.

alter table public.loyalty_program_versions
  add column if not exists reward_kind text not null default 'FREE_ITEM'
    check (reward_kind in ('FREE_ITEM', 'FIXED_DISCOUNT'));

comment on column public.loyalty_program_versions.reward_kind is
  'FREE_ITEM: reward_retail_value_cents is the menu price and reward_est_cost_cents the vendor''s marginal cost (30%% of retail when null). FIXED_DISCOUNT: reward_retail_value_cents is the discount face value and vendor cost equals it exactly — no leverage, no estimate.';

-- Drop the previous 8-argument signature. Adding a parameter via
-- "create or replace" would leave BOTH overloads callable, and PostgREST
-- could resolve to the old kind-blind one — silently restoring the bug this
-- migration exists to fix.
drop function if exists public.loyalty_publish_program(
  uuid, int, int, int, text, int, int, jsonb
);

-- Recreate the publish function so the safety cap is kind-aware. Everything
-- else (role check, versioning, archival) is unchanged.
create or replace function public.loyalty_publish_program(
  p_organization_id uuid,
  p_stamps_required int,
  p_qualifying_min_cents int,
  p_stamp_period_minutes int,
  p_reward_name text,
  p_reward_retail_value_cents int,
  p_reward_est_cost_cents int default null,
  p_advisor_snapshot jsonb default null,
  p_reward_kind text default 'FREE_ITEM'
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_program_id uuid;
  v_next_version int;
  v_version_id uuid;
  v_cost_cents int;
begin
  if not public.has_org_role(p_organization_id, array['owner','manager']::public.organization_role[]) then
    raise exception 'only owners and managers can publish loyalty programs'
      using errcode = '42501';
  end if;

  if p_reward_kind not in ('FREE_ITEM', 'FIXED_DISCOUNT') then
    raise exception 'unsupported reward kind: %', p_reward_kind
      using errcode = 'P0001';
  end if;

  -- Vendor cost depends on the reward kind. A fixed discount costs its full
  -- face value; only a free item may fall back to the 30%-of-retail estimate.
  if p_reward_kind = 'FIXED_DISCOUNT' then
    v_cost_cents := p_reward_retail_value_cents;
  else
    v_cost_cents := coalesce(p_reward_est_cost_cents,
                             (p_reward_retail_value_cents * 30) / 100);
  end if;

  -- Safety cap: vendor reward cost may not exceed 10% of the most
  -- conservative qualifying spend (stamps × qualifying minimum).
  if v_cost_cents * 10 > p_stamps_required * p_qualifying_min_cents then
    raise exception 'reward cost exceeds the platform safety limit (10%% of qualifying spend); lower the reward cost or raise the requirement'
      using errcode = 'P0001';
  end if;

  insert into public.loyalty_programs (organization_id, created_by)
  values (p_organization_id, auth.uid())
  on conflict (organization_id) do update set updated_at = now()
  returning id into v_program_id;

  update public.loyalty_program_versions
     set status = 'archived'
   where program_id = v_program_id and status = 'active';

  select coalesce(max(version_number), 0) + 1 into v_next_version
    from public.loyalty_program_versions where program_id = v_program_id;

  insert into public.loyalty_program_versions
    (program_id, organization_id, version_number, stamps_required,
     qualifying_min_cents, stamp_period_minutes, reward_name,
     reward_retail_value_cents, reward_est_cost_cents, reward_kind,
     advisor_snapshot, created_by)
  values
    (v_program_id, p_organization_id, v_next_version, p_stamps_required,
     p_qualifying_min_cents, p_stamp_period_minutes, p_reward_name,
     p_reward_retail_value_cents,
     case when p_reward_kind = 'FIXED_DISCOUNT'
          then p_reward_retail_value_cents
          else p_reward_est_cost_cents end,
     p_reward_kind, p_advisor_snapshot, auth.uid())
  returning id into v_version_id;

  return v_version_id;
end;
$$;

-- Expose reward_kind on the public preview so customer-facing surfaces can
-- word a discount correctly instead of calling it a "menu value".
create or replace view public.loyalty_program_previews as
select
  p.organization_id,
  o.slug as organization_slug,
  o.display_name as organization_name,
  p.earning_paused,
  p.redemption_paused,
  v.id as program_version_id,
  v.stamps_required,
  v.qualifying_min_cents,
  v.stamp_period_minutes,
  v.reward_name,
  v.reward_retail_value_cents,
  v.reward_kind
from public.loyalty_programs p
join public.organizations o on o.id = p.organization_id
join public.loyalty_program_versions v
  on v.program_id = p.id and v.status = 'active'
where o.status = 'active';

grant select on public.loyalty_program_previews to anon, authenticated;
