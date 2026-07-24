-- Loyalty: pivot from visit-based stamps to spend-based points.
--
-- Big-chain loyalty is "verified dollars spent → points → a controlled reward
-- catalog". The only trustworthy purchase signal CurbAgora has today is a
-- staff member confirming a customer's single-use code at the counter, so this
-- keeps that exact verification spine and adds ONE thing: the staff member
-- enters the verified eligible subtotal when they confirm the code. The server
-- computes points = floor(subtotal_cents × points_per_dollar / 100). A customer
-- never types their own amount.
--
-- Forward-only. Additive to the schema (old stamp columns are left in place,
-- unused, so existing local rows are never deleted); the earning/redemption
-- FUNCTIONS are replaced with points versions and the stamp-era ones dropped.

begin;

-- ---------------------------------------------------------------------------
-- Ledger entry types: move from enum to text+check so new values can be added
-- in the same migration that references them (ALTER TYPE ADD VALUE cannot be
-- used in the transaction that defines it).
-- ---------------------------------------------------------------------------
-- The partial unique index enforcing one FIRST_VISIT_BONUS per account has an
-- enum literal in its predicate; drop it before retyping the column. The
-- first-visit bonus is removed with the stamp model, so it is not recreated.
drop index if exists public.loyalty_ledger_entries_first_bonus_once;

alter table public.loyalty_ledger_entries
  alter column entry_type type text using entry_type::text;

alter table public.loyalty_ledger_entries
  add constraint loyalty_ledger_entry_type_check
  check (entry_type in (
    'PURCHASE_POINTS', 'PROMO_BONUS', 'REDEMPTION',
    'REVERSAL', 'MANUAL_ADJUSTMENT',
    -- retained so historical stamp-era rows remain valid:
    'PURCHASE_STAMP', 'FIRST_VISIT_BONUS'
  ));

-- Points columns alongside the retained stamp columns.
alter table public.loyalty_ledger_entries
  add column if not exists delta_points int,
  add column if not exists verified_subtotal_cents int
    check (verified_subtotal_cents is null or verified_subtotal_cents >= 0);

-- New rows are points-only, so stamps may be null; drop the old NOT NULL /
-- non-zero guard and require exactly one of the two deltas to be set.
alter table public.loyalty_ledger_entries
  alter column delta_stamps drop not null;
alter table public.loyalty_ledger_entries
  drop constraint if exists loyalty_ledger_entries_delta_stamps_check;
alter table public.loyalty_ledger_entries
  add constraint loyalty_ledger_one_delta check (
    (delta_points is not null and delta_points <> 0 and delta_stamps is null)
    or
    (delta_stamps is not null and delta_stamps <> 0 and delta_points is null)
  );

-- ---------------------------------------------------------------------------
-- Accounts: point balance projection.
-- ---------------------------------------------------------------------------
alter table public.loyalty_accounts
  add column if not exists point_balance int not null default 0,
  add column if not exists lifetime_points int not null default 0;

-- ---------------------------------------------------------------------------
-- Program versions: points-per-dollar. Stamp columns retained but unused; the
-- reward now lives in a catalog (below), so reward_* columns become nullable.
-- ---------------------------------------------------------------------------
alter table public.loyalty_program_versions
  add column if not exists points_per_dollar int
    check (points_per_dollar is null or points_per_dollar between 1 and 100);
alter table public.loyalty_program_versions
  alter column stamps_required drop not null,
  alter column qualifying_min_cents drop not null,
  alter column reward_name drop not null,
  alter column reward_retail_value_cents drop not null;

-- ---------------------------------------------------------------------------
-- Reward catalog: one program version has several point-priced rewards. The
-- catalog is immutable per version (a change = a new version), preserving the
-- append-only / grandfathering model.
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_reward_catalog_items (
  id uuid primary key default gen_random_uuid(),
  program_version_id uuid not null
    references public.loyalty_program_versions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sort_index int not null default 0,
  points_cost int not null check (points_cost > 0),
  reward_kind text not null check (reward_kind in ('FREE_ITEM', 'FIXED_DISCOUNT')),
  reward_name text not null check (char_length(reward_name) between 1 and 120),
  -- Menu price for a free item; discount face value for a discount.
  reward_value_cents int not null check (reward_value_cents > 0),
  -- Vendor cost for a free item (null → 30%-of-value estimate). For a discount
  -- the publish function stores the full face value here.
  reward_est_cost_cents int check (reward_est_cost_cents is null or reward_est_cost_cents >= 0),
  created_at timestamptz not null default now()
);

create index if not exists loyalty_catalog_version_idx
  on public.loyalty_reward_catalog_items (program_version_id, sort_index);

alter table public.loyalty_reward_catalog_items enable row level security;

-- Members (and platform admins) can read their org's catalog directly.
create policy "loyalty_catalog_select_member"
  on public.loyalty_reward_catalog_items for select to authenticated
  using (
    public.is_org_member(organization_id) or public.is_platform_admin()
  );
-- No client insert/update/delete: catalog is written only by the definer
-- publish function.

grant select on public.loyalty_reward_catalog_items to authenticated;

-- ---------------------------------------------------------------------------
-- Redemptions: spend points, reference the chosen catalog item.
-- ---------------------------------------------------------------------------
alter table public.loyalty_redemptions
  add column if not exists points_spent int
    check (points_spent is null or points_spent > 0),
  add column if not exists catalog_item_id uuid
    references public.loyalty_reward_catalog_items (id);
alter table public.loyalty_redemptions
  alter column stamps_spent drop not null;

-- ---------------------------------------------------------------------------
-- Balance projection trigger: maintain point_balance from delta_points.
-- (Stamp-era rows are already applied; new inserts are points-only.)
-- ---------------------------------------------------------------------------
create or replace function public.loyalty_apply_ledger_entry()
returns trigger language plpgsql as $$
begin
  if new.delta_points is not null then
    update public.loyalty_accounts
       set point_balance = point_balance + new.delta_points,
           lifetime_points = lifetime_points + greatest(new.delta_points, 0),
           updated_at = now()
     where id = new.account_id;
  elsif new.delta_stamps is not null then
    update public.loyalty_accounts
       set stamp_balance = stamp_balance + new.delta_stamps,
           lifetime_stamps = lifetime_stamps + greatest(new.delta_stamps, 0),
           updated_at = now()
     where id = new.account_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publish: owner/manager sets points-per-dollar + a reward catalog. The 10%
-- cost cap is re-checked per catalog tier, kind-aware (a discount costs its
-- full face value; a free item may fall back to a 30% estimate).
-- ---------------------------------------------------------------------------
drop function if exists public.loyalty_publish_program(uuid, int, int, int, text, int, int, jsonb);
drop function if exists public.loyalty_publish_program(uuid, int, int, int, text, int, int, jsonb, text);

create or replace function public.loyalty_publish_program(
  p_organization_id uuid,
  p_points_per_dollar int,
  p_catalog jsonb,
  p_advisor_snapshot jsonb default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_program_id uuid;
  v_next_version int;
  v_version_id uuid;
  v_item jsonb;
  v_cost int;
  v_kind text;
  v_value int;
  v_points int;
  v_spend int;
  v_count int := 0;
begin
  if not public.has_org_role(p_organization_id, array['owner','manager']::public.organization_role[]) then
    raise exception 'only owners and managers can publish loyalty programs'
      using errcode = '42501';
  end if;

  if p_points_per_dollar is null or p_points_per_dollar < 1 or p_points_per_dollar > 100 then
    raise exception 'points per dollar must be between 1 and 100' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_catalog) <> 'array' or jsonb_array_length(p_catalog) = 0 then
    raise exception 'the reward catalog must have at least one reward' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_catalog) > 6 then
    raise exception 'a catalog may have at most 6 rewards' using errcode = 'P0001';
  end if;

  -- Validate every tier before writing anything.
  for v_item in select * from jsonb_array_elements(p_catalog)
  loop
    v_kind := v_item->>'reward_kind';
    v_value := (v_item->>'reward_value_cents')::int;
    v_points := (v_item->>'points_cost')::int;
    if v_kind not in ('FREE_ITEM', 'FIXED_DISCOUNT') then
      raise exception 'unsupported reward kind: %', v_kind using errcode = 'P0001';
    end if;
    if v_points is null or v_points <= 0 then
      raise exception 'each reward needs a positive points cost' using errcode = 'P0001';
    end if;
    if v_value is null or v_value <= 0 then
      raise exception 'each reward needs a positive value' using errcode = 'P0001';
    end if;

    if v_kind = 'FIXED_DISCOUNT' then
      v_cost := v_value;
    else
      v_cost := coalesce((v_item->>'reward_est_cost_cents')::int, (v_value * 30) / 100);
    end if;

    -- Spend to earn this reward = points_cost / points_per_dollar dollars.
    v_spend := (v_points * 100) / p_points_per_dollar;
    if v_cost * 10 > v_spend then
      raise exception 'reward "%" costs more than 10%% of the spend needed to earn it; lower its cost or raise its points',
        coalesce(v_item->>'reward_name', 'reward') using errcode = 'P0001';
    end if;
  end loop;

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
    (program_id, organization_id, version_number, points_per_dollar,
     advisor_snapshot, created_by)
  values
    (v_program_id, p_organization_id, v_next_version, p_points_per_dollar,
     p_advisor_snapshot, auth.uid())
  returning id into v_version_id;

  for v_item in select * from jsonb_array_elements(p_catalog)
  loop
    v_kind := v_item->>'reward_kind';
    v_value := (v_item->>'reward_value_cents')::int;
    insert into public.loyalty_reward_catalog_items
      (program_version_id, organization_id, sort_index, points_cost,
       reward_kind, reward_name, reward_value_cents, reward_est_cost_cents)
    values
      (v_version_id, p_organization_id, v_count, (v_item->>'points_cost')::int,
       v_kind, v_item->>'reward_name', v_value,
       case when v_kind = 'FIXED_DISCOUNT' then v_value
            else (v_item->>'reward_est_cost_cents')::int end);
    v_count := v_count + 1;
  end loop;

  return v_version_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirm a purchase: staff enters the verified eligible subtotal along with
-- the customer's code. Replaces the stamp confirm_claim entirely.
-- ---------------------------------------------------------------------------
drop function if exists public.loyalty_confirm_claim(uuid, text);

create or replace function public.loyalty_confirm_purchase(
  p_organization_id uuid,
  p_code text,
  p_eligible_subtotal_cents int
) returns table (points_awarded int, point_balance int)
language plpgsql security definer set search_path = public
as $$
declare
  v_claim public.loyalty_claim_codes%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_version public.loyalty_program_versions%rowtype;
  v_points int;
  v_balance int;
  v_recent int;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'only members of this organization can confirm purchases'
      using errcode = '42501';
  end if;

  -- Platform-enforced sanity bounds on the staff-entered amount. A customer
  -- never supplies this; a staff member reads it from the register.
  if p_eligible_subtotal_cents is null or p_eligible_subtotal_cents <= 0 then
    raise exception 'enter the eligible purchase amount' using errcode = 'P0001';
  end if;
  if p_eligible_subtotal_cents > 100000 then
    raise exception 'that amount looks too large (max $1,000 per purchase); re-enter it'
      using errcode = 'P0001';
  end if;

  select * into v_claim from public.loyalty_claim_codes
   where organization_id = p_organization_id
     and code = upper(trim(p_code))
     and status = 'pending'
   for update;
  if not found then
    raise exception 'code not found — ask the customer to open their newest code'
      using errcode = 'P0001';
  end if;
  if v_claim.expires_at < now() then
    update public.loyalty_claim_codes set status = 'expired' where id = v_claim.id;
    raise exception 'this code has expired — ask the customer for a fresh one'
      using errcode = 'P0001';
  end if;

  select * into v_program from public.loyalty_programs
   where organization_id = p_organization_id;
  if v_program.earning_paused then
    raise exception 'points earning is paused for this program' using errcode = 'P0001';
  end if;
  select * into v_version from public.loyalty_program_versions
   where program_id = v_program.id and status = 'active';
  if not found or v_version.points_per_dollar is null then
    raise exception 'no active points program' using errcode = 'P0001';
  end if;

  -- Velocity: at most 6 confirmed purchases per customer per hour.
  select count(*) into v_recent
    from public.loyalty_ledger_entries l
   where l.account_id = v_claim.account_id
     and l.entry_type = 'PURCHASE_POINTS'
     and l.created_at > now() - interval '1 hour';
  if v_recent >= 6 then
    raise exception 'too many purchases confirmed for this customer in the last hour'
      using errcode = 'P0001';
  end if;

  v_points := (p_eligible_subtotal_cents * v_version.points_per_dollar) / 100;
  if v_points <= 0 then
    raise exception 'that purchase is below the amount needed to earn a point'
      using errcode = 'P0001';
  end if;

  insert into public.loyalty_ledger_entries
    (account_id, organization_id, program_version_id, entry_type,
     delta_points, verified_subtotal_cents, idempotency_key,
     claim_code_id, actor_user_id)
  values
    (v_claim.account_id, p_organization_id, v_version.id, 'PURCHASE_POINTS',
     v_points, p_eligible_subtotal_cents, 'claim:' || v_claim.id,
     v_claim.id, auth.uid());

  update public.loyalty_claim_codes
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
   where id = v_claim.id;

  select a.point_balance into v_balance
    from public.loyalty_accounts a where a.id = v_claim.account_id;

  return query select v_points, v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- Request a redemption of a specific catalog item.
-- ---------------------------------------------------------------------------
drop function if exists public.loyalty_request_redemption(uuid);

create or replace function public.loyalty_request_redemption(
  p_organization_id uuid,
  p_catalog_item_id uuid
) returns table (code text, reward_name text, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_account public.loyalty_accounts%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_version public.loyalty_program_versions%rowtype;
  v_item public.loyalty_reward_catalog_items%rowtype;
  v_code text;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_program from public.loyalty_programs
   where organization_id = p_organization_id;
  if not found or v_program.redemption_paused then
    raise exception 'redemptions are not available right now' using errcode = 'P0001';
  end if;
  select * into v_version from public.loyalty_program_versions
   where program_id = v_program.id and status = 'active';
  if not found then
    raise exception 'no active loyalty program' using errcode = 'P0001';
  end if;

  select * into v_item from public.loyalty_reward_catalog_items
   where id = p_catalog_item_id and program_version_id = v_version.id;
  if not found then
    raise exception 'that reward is not part of the current program' using errcode = 'P0001';
  end if;

  select * into v_account from public.loyalty_accounts
   where organization_id = p_organization_id and user_id = auth.uid()
   for update;
  if not found or v_account.point_balance < v_item.points_cost then
    raise exception 'not enough points for that reward yet' using errcode = 'P0001';
  end if;

  -- Clear any stale open redemption so the customer is never stuck.
  update public.loyalty_redemptions r
     set status = 'expired'
   where r.account_id = v_account.id
     and r.status = 'requested'
     and r.expires_at < now();

  v_code := public.loyalty_generate_code();
  v_expires := now() + interval '15 minutes';

  insert into public.loyalty_redemptions
    (account_id, organization_id, program_version_id, code, points_spent,
     catalog_item_id, reward_name, expires_at)
  values
    (v_account.id, p_organization_id, v_version.id, v_code, v_item.points_cost,
     v_item.id, v_item.reward_name, v_expires);

  return query select v_code, v_item.reward_name, v_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirm a redemption: staff verifies the code, points are deducted.
-- ---------------------------------------------------------------------------
create or replace function public.loyalty_confirm_redemption(
  p_organization_id uuid,
  p_code text
) returns table (reward_name text, remaining_balance int)
language plpgsql security definer set search_path = public
as $$
declare
  v_redemption public.loyalty_redemptions%rowtype;
  v_account public.loyalty_accounts%rowtype;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'only members of this organization can confirm redemptions'
      using errcode = '42501';
  end if;

  select * into v_redemption from public.loyalty_redemptions
   where organization_id = p_organization_id
     and code = upper(trim(p_code))
     and status = 'requested'
   for update;
  if not found then
    raise exception 'redemption code not found' using errcode = 'P0001';
  end if;
  if v_redemption.expires_at < now() then
    update public.loyalty_redemptions set status = 'expired' where id = v_redemption.id;
    raise exception 'this redemption code has expired' using errcode = 'P0001';
  end if;

  -- Re-check balance under lock: double-spend structurally impossible.
  select * into v_account from public.loyalty_accounts
   where id = v_redemption.account_id for update;
  if v_account.point_balance < v_redemption.points_spent then
    raise exception 'balance is no longer sufficient for this reward'
      using errcode = 'P0001';
  end if;

  insert into public.loyalty_ledger_entries
    (account_id, organization_id, program_version_id, entry_type,
     delta_points, idempotency_key, redemption_id, actor_user_id)
  values
    (v_account.id, p_organization_id, v_redemption.program_version_id,
     'REDEMPTION', -v_redemption.points_spent,
     'redeem:' || v_redemption.id, v_redemption.id, auth.uid());

  update public.loyalty_redemptions
     set status = 'redeemed', confirmed_by = auth.uid(), confirmed_at = now()
   where id = v_redemption.id;

  return query
    select v_redemption.reward_name,
           v_account.point_balance - v_redemption.points_spent;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reverse an entry (refund handling) — points-aware.
-- ---------------------------------------------------------------------------
create or replace function public.loyalty_reverse_entry(
  p_entry_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_entry public.loyalty_ledger_entries%rowtype;
begin
  select * into v_entry from public.loyalty_ledger_entries where id = p_entry_id;
  if not found then
    raise exception 'ledger entry not found' using errcode = 'P0001';
  end if;
  if not public.has_org_role(v_entry.organization_id, array['owner','manager']::public.organization_role[]) then
    raise exception 'only owners and managers can reverse loyalty entries'
      using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to reverse an entry' using errcode = 'P0001';
  end if;
  if v_entry.delta_points is null then
    raise exception 'only points entries can be reversed in this program' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.loyalty_ledger_entries l where l.reverses_entry_id = p_entry_id) then
    raise exception 'this entry has already been reversed' using errcode = 'P0001';
  end if;

  insert into public.loyalty_ledger_entries
    (account_id, organization_id, program_version_id, entry_type,
     delta_points, reason, idempotency_key, reverses_entry_id, actor_user_id)
  values
    (v_entry.account_id, v_entry.organization_id, v_entry.program_version_id,
     'REVERSAL', -v_entry.delta_points, trim(p_reason),
     'reverse:' || p_entry_id, p_entry_id, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Manual owner adjustment — points-aware, capped and audited.
-- ---------------------------------------------------------------------------
-- The stamp-era signature had the same arg types but a differently named
-- parameter (p_delta), which CREATE OR REPLACE cannot rename.
drop function if exists public.loyalty_adjust_balance(uuid, int, text);

create or replace function public.loyalty_adjust_balance(
  p_account_id uuid,
  p_delta_points int,
  p_reason text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_account public.loyalty_accounts%rowtype;
  v_version_id uuid;
  v_recent int;
begin
  select * into v_account from public.loyalty_accounts where id = p_account_id;
  if not found then
    raise exception 'loyalty account not found' using errcode = 'P0001';
  end if;
  if not public.has_org_role(v_account.organization_id, array['owner']::public.organization_role[]) then
    raise exception 'only owners can make manual adjustments' using errcode = '42501';
  end if;
  if p_delta_points = 0 or abs(p_delta_points) > 2000 then
    raise exception 'manual adjustments are limited to ±2000 points' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required for manual adjustments' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
    from public.loyalty_ledger_entries l
   where l.account_id = p_account_id
     and l.entry_type = 'MANUAL_ADJUSTMENT'
     and l.created_at > now() - interval '30 days';
  if v_recent >= 3 then
    raise exception 'manual adjustment limit reached for this customer this month'
      using errcode = 'P0001';
  end if;

  select v.id into v_version_id
    from public.loyalty_program_versions v
   where v.organization_id = v_account.organization_id and v.status = 'active';
  if v_version_id is null then
    raise exception 'no active loyalty program' using errcode = 'P0001';
  end if;

  insert into public.loyalty_ledger_entries
    (account_id, organization_id, program_version_id, entry_type,
     delta_points, reason, idempotency_key, actor_user_id)
  values
    (p_account_id, v_account.organization_id, v_version_id,
     'MANUAL_ADJUSTMENT', p_delta_points, trim(p_reason),
     'adjust:' || gen_random_uuid(), auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Program stats — points. Liability estimates outstanding points at the
-- cheapest reward's cost-per-point (a conservative floor, clearly labeled in
-- the UI as an estimate).
-- ---------------------------------------------------------------------------
-- Return columns changed from the stamp version, so drop before recreating.
drop function if exists public.loyalty_program_stats(uuid);

create or replace function public.loyalty_program_stats(
  p_organization_id uuid
) returns table (
  members int,
  points_issued bigint,
  rewards_redeemed bigint,
  outstanding_points bigint,
  estimated_liability_cents bigint
)
language plpgsql security definer set search_path = public
as $$
declare
  v_version public.loyalty_program_versions%rowtype;
  v_cheapest_points int;
  v_cheapest_cost int;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'only members of this organization can view loyalty stats'
      using errcode = '42501';
  end if;
  select * into v_version from public.loyalty_program_versions
   where organization_id = p_organization_id and status = 'active';

  select ci.points_cost,
         case when ci.reward_kind = 'FIXED_DISCOUNT' then ci.reward_value_cents
              else coalesce(ci.reward_est_cost_cents, (ci.reward_value_cents * 30) / 100) end
    into v_cheapest_points, v_cheapest_cost
    from public.loyalty_reward_catalog_items ci
   where ci.program_version_id = v_version.id
   order by ci.points_cost asc
   limit 1;

  return query
    select
      (select count(*)::int from public.loyalty_accounts a
        where a.organization_id = p_organization_id),
      (select coalesce(sum(l.delta_points) filter (where l.delta_points > 0), 0)
         from public.loyalty_ledger_entries l
        where l.organization_id = p_organization_id),
      (select count(*) from public.loyalty_redemptions r
        where r.organization_id = p_organization_id and r.status = 'redeemed'),
      (select coalesce(sum(a.point_balance) filter (where a.point_balance > 0), 0)
         from public.loyalty_accounts a
        where a.organization_id = p_organization_id),
      case when v_cheapest_points is null or v_cheapest_points = 0 then 0::bigint
           else (select coalesce(sum(a.point_balance / v_cheapest_points), 0) * v_cheapest_cost
                   from public.loyalty_accounts a
                  where a.organization_id = p_organization_id
                    and a.point_balance > 0)
      end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public preview: points-per-dollar + aggregated catalog for customer surfaces.
-- ---------------------------------------------------------------------------
-- Column set changes from the stamp view, so replace-in-place is not allowed.
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
where o.status = 'active';

grant select on public.loyalty_program_previews to anon, authenticated;

-- Function grants.
revoke all on function public.loyalty_publish_program(uuid, int, jsonb, jsonb) from public;
grant execute on function public.loyalty_publish_program(uuid, int, jsonb, jsonb) to authenticated;
grant execute on function public.loyalty_confirm_purchase(uuid, text, int) to authenticated;
grant execute on function public.loyalty_request_redemption(uuid, uuid) to authenticated;

commit;
