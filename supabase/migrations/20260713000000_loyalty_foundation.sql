-- ============================================================================
-- Loyalty foundation: digital stamp cards for vendor organizations.
--
-- Design (docs/decisions/loyalty-system.md):
--   * Append-only ledger (loyalty_ledger_entries) is the source of truth;
--     account balances are trigger-maintained projections of it. UPDATE
--     and DELETE on the ledger are rejected at the database layer.
--   * ALL financial writes go through SECURITY DEFINER functions that
--     validate roles, bounds, idempotency, and velocity limits. There are
--     deliberately NO insert/update policies on these tables for clients.
--   * Earning is staff-verified: the customer creates a short-lived
--     single-use claim code; an authenticated member of the vendor org
--     confirms it at the counter. No static/reusable QR value exists.
--   * Rules are versioned: exactly one ACTIVE version per program;
--     ledger entries and redemptions record the version they ran under.
--   * MVP template: stamp card only (see the decision doc for why spend-
--     and item-based templates are deferred until orders/menus exist).
-- ============================================================================

create type public.loyalty_entry_type as enum (
  'PURCHASE_STAMP',
  'FIRST_VISIT_BONUS',
  'REDEMPTION',
  'REVERSAL',
  'MANUAL_ADJUSTMENT'
);

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  earning_paused boolean not null default false,
  redemption_paused boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger loyalty_programs_set_updated_at
  before update on public.loyalty_programs
  for each row execute function public.set_updated_at();

create table public.loyalty_program_versions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loyalty_programs (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  version_number int not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  stamps_required int not null check (stamps_required between 4 and 10),
  qualifying_min_cents int not null check (qualifying_min_cents between 100 and 10000),
  stamp_period_minutes int not null default 240 check (stamp_period_minutes >= 60),
  reward_name text not null check (char_length(reward_name) between 1 and 120),
  reward_retail_value_cents int not null check (reward_retail_value_cents > 0),
  -- Null = vendor hasn't entered cost data; the app then uses a clearly
  -- labeled 30%-of-retail estimate and says so everywhere.
  reward_est_cost_cents int check (reward_est_cost_cents is null or reward_est_cost_cents >= 0),
  -- Consultation answers + calculator outputs the owner approved, for
  -- audit/reproducibility. Never used at runtime for money math.
  advisor_snapshot jsonb,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (program_id, version_number)
);

create unique index loyalty_program_versions_one_active
  on public.loyalty_program_versions (program_id) where status = 'active';
create index loyalty_program_versions_org_idx
  on public.loyalty_program_versions (organization_id);

create table public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Projection of the ledger, maintained by trigger. May go negative
  -- after a reversal of already-redeemed value (visible debt, recovered
  -- by future earning) — so no >= 0 constraint here; spending paths
  -- re-check balance under row locks instead.
  stamp_balance int not null default 0,
  lifetime_stamps int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create trigger loyalty_accounts_set_updated_at
  before update on public.loyalty_accounts
  for each row execute function public.set_updated_at();

create table public.loyalty_claim_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.loyalty_accounts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

-- One live code per account; codes must be unambiguous per org while open.
create unique index loyalty_claim_codes_one_pending_per_account
  on public.loyalty_claim_codes (account_id) where status = 'pending';
create unique index loyalty_claim_codes_open_code
  on public.loyalty_claim_codes (organization_id, code) where status = 'pending';
create index loyalty_claim_codes_account_idx on public.loyalty_claim_codes (account_id);

create table public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.loyalty_accounts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  program_version_id uuid not null references public.loyalty_program_versions (id),
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  status text not null default 'requested'
    check (status in ('requested', 'redeemed', 'cancelled', 'expired')),
  stamps_spent int not null check (stamps_spent > 0),
  reward_name text not null,
  expires_at timestamptz not null,
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index loyalty_redemptions_one_open_per_account
  on public.loyalty_redemptions (account_id) where status = 'requested';
create unique index loyalty_redemptions_open_code
  on public.loyalty_redemptions (organization_id, code) where status = 'requested';
create index loyalty_redemptions_account_idx on public.loyalty_redemptions (account_id);

create table public.loyalty_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.loyalty_accounts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  program_version_id uuid not null references public.loyalty_program_versions (id),
  entry_type public.loyalty_entry_type not null,
  delta_stamps int not null check (delta_stamps <> 0),
  reason text,
  idempotency_key text not null unique,
  reverses_entry_id uuid references public.loyalty_ledger_entries (id),
  claim_code_id uuid references public.loyalty_claim_codes (id),
  redemption_id uuid references public.loyalty_redemptions (id),
  actor_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

-- An entry can be reversed at most once.
create unique index loyalty_ledger_entries_reversal_once
  on public.loyalty_ledger_entries (reverses_entry_id)
  where reverses_entry_id is not null;
-- The first-visit bonus is one-time per customer×vendor relationship —
-- enforced structurally, not just in application code.
create unique index loyalty_ledger_entries_first_bonus_once
  on public.loyalty_ledger_entries (account_id)
  where entry_type = 'FIRST_VISIT_BONUS';
create index loyalty_ledger_entries_account_idx
  on public.loyalty_ledger_entries (account_id, created_at desc);
create index loyalty_ledger_entries_org_idx
  on public.loyalty_ledger_entries (organization_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Append-only enforcement + balance projection
-- ----------------------------------------------------------------------------

create or replace function public.loyalty_ledger_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'loyalty ledger entries are append-only; corrections must be new REVERSAL or MANUAL_ADJUSTMENT entries'
    using errcode = 'P0001';
end;
$$;

create trigger loyalty_ledger_entries_append_only
  before update or delete on public.loyalty_ledger_entries
  for each row execute function public.loyalty_ledger_immutable();

create or replace function public.loyalty_apply_ledger_entry()
returns trigger language plpgsql as $$
begin
  update public.loyalty_accounts
     set stamp_balance = stamp_balance + new.delta_stamps,
         lifetime_stamps = lifetime_stamps + greatest(new.delta_stamps, 0)
   where id = new.account_id;
  return new;
end;
$$;

create trigger loyalty_ledger_entries_apply
  after insert on public.loyalty_ledger_entries
  for each row execute function public.loyalty_apply_ledger_entry();

-- ----------------------------------------------------------------------------
-- Row level security: reads are scoped; writes only via definer functions.
-- ----------------------------------------------------------------------------

alter table public.loyalty_programs enable row level security;
alter table public.loyalty_program_versions enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_claim_codes enable row level security;
alter table public.loyalty_redemptions enable row level security;
alter table public.loyalty_ledger_entries enable row level security;

create policy "loyalty_programs_select_member"
  on public.loyalty_programs for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());

create policy "loyalty_program_versions_select_member"
  on public.loyalty_program_versions for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());

create policy "loyalty_accounts_select_own_or_member"
  on public.loyalty_accounts for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_member(organization_id)
    or public.is_platform_admin()
  );

create policy "loyalty_claim_codes_select_own_or_member"
  on public.loyalty_claim_codes for select to authenticated
  using (
    exists (select 1 from public.loyalty_accounts a
            where a.id = account_id and a.user_id = (select auth.uid()))
    or public.is_org_member(organization_id)
    or public.is_platform_admin()
  );

create policy "loyalty_redemptions_select_own_or_member"
  on public.loyalty_redemptions for select to authenticated
  using (
    exists (select 1 from public.loyalty_accounts a
            where a.id = account_id and a.user_id = (select auth.uid()))
    or public.is_org_member(organization_id)
    or public.is_platform_admin()
  );

create policy "loyalty_ledger_entries_select_own_or_member"
  on public.loyalty_ledger_entries for select to authenticated
  using (
    exists (select 1 from public.loyalty_accounts a
            where a.id = account_id and a.user_id = (select auth.uid()))
    or public.is_org_member(organization_id)
    or public.is_platform_admin()
  );

grant select on public.loyalty_programs to authenticated;
grant select on public.loyalty_program_versions to authenticated;
grant select on public.loyalty_accounts to authenticated;
grant select on public.loyalty_claim_codes to authenticated;
grant select on public.loyalty_redemptions to authenticated;
grant select on public.loyalty_ledger_entries to authenticated;

-- Public program preview: what any customer may know about an active
-- program (marketing-level info only; runs with owner privileges by
-- design, mirroring vendor_unit_previews).
create view public.loyalty_program_previews as
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
  v.reward_retail_value_cents
from public.loyalty_programs p
join public.organizations o on o.id = p.organization_id
join public.loyalty_program_versions v
  on v.program_id = p.id and v.status = 'active'
where o.status = 'active';

grant select on public.loyalty_program_previews to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- Unambiguous code alphabet (no 0/O/1/I).
create or replace function public.loyalty_generate_code()
returns text language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
           1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;

-- ----------------------------------------------------------------------------
-- Financial functions (SECURITY DEFINER; the ONLY write paths)
-- ----------------------------------------------------------------------------

-- Publish (create or replace) the org's program rules as a new version.
-- Owner/manager only. Platform bounds re-checked here regardless of what
-- any UI or advisor suggested; cost-rate hard cap of 10% blocks publish.
create or replace function public.loyalty_publish_program(
  p_organization_id uuid,
  p_stamps_required int,
  p_qualifying_min_cents int,
  p_stamp_period_minutes int,
  p_reward_name text,
  p_reward_retail_value_cents int,
  p_reward_est_cost_cents int default null,
  p_advisor_snapshot jsonb default null
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

  -- Safety cap: estimated reward cost may not exceed 10% of the most
  -- conservative qualifying spend (stamps × qualifying minimum).
  v_cost_cents := coalesce(p_reward_est_cost_cents,
                           (p_reward_retail_value_cents * 30) / 100);
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
     reward_retail_value_cents, reward_est_cost_cents, advisor_snapshot,
     created_by)
  values
    (v_program_id, p_organization_id, v_next_version, p_stamps_required,
     p_qualifying_min_cents, p_stamp_period_minutes, p_reward_name,
     p_reward_retail_value_cents, p_reward_est_cost_cents,
     p_advisor_snapshot, auth.uid())
  returning id into v_version_id;

  return v_version_id;
end;
$$;

create or replace function public.loyalty_set_program_paused(
  p_organization_id uuid,
  p_earning_paused boolean,
  p_redemption_paused boolean
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_org_role(p_organization_id, array['owner','manager']::public.organization_role[]) then
    raise exception 'only owners and managers can pause loyalty programs'
      using errcode = '42501';
  end if;
  update public.loyalty_programs
     set earning_paused = p_earning_paused,
         redemption_paused = p_redemption_paused
   where organization_id = p_organization_id;
  if not found then
    raise exception 'no loyalty program exists for this organization'
      using errcode = 'P0001';
  end if;
end;
$$;

-- Customer requests a claim code to show at the counter.
create or replace function public.loyalty_create_claim_code(
  p_organization_id uuid
) returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id uuid;
  v_program public.loyalty_programs%rowtype;
  v_code text;
  v_expires timestamptz;
  v_today_count int;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_program from public.loyalty_programs
   where organization_id = p_organization_id;
  if not found or v_program.earning_paused then
    raise exception 'this vendor is not currently issuing stamps'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.loyalty_program_versions v
                  where v.program_id = v_program.id and v.status = 'active') then
    raise exception 'this vendor is not currently issuing stamps'
      using errcode = 'P0001';
  end if;

  insert into public.loyalty_accounts (organization_id, user_id)
  values (p_organization_id, auth.uid())
  on conflict (organization_id, user_id) do update set updated_at = now()
  returning id into v_account_id;

  select count(*) into v_today_count
    from public.loyalty_claim_codes c
   where c.account_id = v_account_id
     and c.created_at > now() - interval '24 hours';
  if v_today_count >= 10 then
    raise exception 'too many stamp codes created today; please try again later'
      using errcode = 'P0001';
  end if;

  -- Replace any previous open code (one live code per account).
  update public.loyalty_claim_codes
     set status = 'cancelled'
   where account_id = v_account_id and status = 'pending';

  v_code := public.loyalty_generate_code();
  v_expires := now() + interval '10 minutes';

  insert into public.loyalty_claim_codes
    (account_id, organization_id, code, expires_at)
  values (v_account_id, p_organization_id, v_code, v_expires);

  return query select v_code, v_expires;
end;
$$;

-- Staff confirms the customer's code after taking a qualifying order.
create or replace function public.loyalty_confirm_claim(
  p_organization_id uuid,
  p_code text
) returns table (stamp_balance int, stamps_required int, first_visit boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_claim public.loyalty_claim_codes%rowtype;
  v_version public.loyalty_program_versions%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_last_stamp timestamptz;
  v_first boolean := false;
  v_balance int;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'only members of this organization can confirm stamps'
      using errcode = '42501';
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
    raise exception 'stamp earning is paused for this program' using errcode = 'P0001';
  end if;
  select * into v_version from public.loyalty_program_versions
   where program_id = v_program.id and status = 'active';
  if not found then
    raise exception 'no active loyalty program' using errcode = 'P0001';
  end if;

  -- Velocity: at most one stamp per configured period per customer.
  select max(l.created_at) into v_last_stamp
    from public.loyalty_ledger_entries l
   where l.account_id = v_claim.account_id
     and l.entry_type = 'PURCHASE_STAMP';
  if v_last_stamp is not null
     and v_last_stamp > now() - make_interval(mins => v_version.stamp_period_minutes) then
    raise exception 'this customer already received a stamp recently (limit: one per % minutes)', v_version.stamp_period_minutes
      using errcode = 'P0001';
  end if;

  insert into public.loyalty_ledger_entries
    (account_id, organization_id, program_version_id, entry_type,
     delta_stamps, idempotency_key, claim_code_id, actor_user_id)
  values
    (v_claim.account_id, p_organization_id, v_version.id, 'PURCHASE_STAMP',
     1, 'claim:' || v_claim.id, v_claim.id, auth.uid());

  -- One-time endowed progress on the very first qualifying visit;
  -- structurally unique per account (partial unique index).
  if not exists (select 1 from public.loyalty_ledger_entries l
                  where l.account_id = v_claim.account_id
                    and l.entry_type = 'FIRST_VISIT_BONUS') then
    insert into public.loyalty_ledger_entries
      (account_id, organization_id, program_version_id, entry_type,
       delta_stamps, idempotency_key, claim_code_id, actor_user_id)
    values
      (v_claim.account_id, p_organization_id, v_version.id, 'FIRST_VISIT_BONUS',
       1, 'first:' || v_claim.account_id, v_claim.id, auth.uid());
    v_first := true;
  end if;

  update public.loyalty_claim_codes
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
   where id = v_claim.id;

  select a.stamp_balance into v_balance
    from public.loyalty_accounts a where a.id = v_claim.account_id;

  return query select v_balance, v_version.stamps_required, v_first;
end;
$$;

-- Customer starts a redemption when their card is full.
create or replace function public.loyalty_request_redemption(
  p_organization_id uuid
) returns table (code text, reward_name text, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_account public.loyalty_accounts%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_version public.loyalty_program_versions%rowtype;
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

  select * into v_account from public.loyalty_accounts
   where organization_id = p_organization_id and user_id = auth.uid()
   for update;
  if not found or v_account.stamp_balance < v_version.stamps_required then
    raise exception 'not enough stamps yet' using errcode = 'P0001';
  end if;

  -- Expire a stale open redemption so the customer is never stuck.
  -- (Qualified names: the output columns of this function would otherwise
  -- shadow the table columns inside this statement.)
  update public.loyalty_redemptions r
     set status = 'expired'
   where r.account_id = v_account.id
     and r.status = 'requested'
     and r.expires_at < now();

  v_code := public.loyalty_generate_code();
  v_expires := now() + interval '15 minutes';

  insert into public.loyalty_redemptions
    (account_id, organization_id, program_version_id, code, stamps_spent,
     reward_name, expires_at)
  values
    (v_account.id, p_organization_id, v_version.id, v_code,
     v_version.stamps_required, v_version.reward_name, v_expires);

  return query select v_code, v_version.reward_name, v_expires;
end;
$$;

-- Staff confirms the redemption and hands over the reward.
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
  if v_account.stamp_balance < v_redemption.stamps_spent then
    raise exception 'balance is no longer sufficient for this reward'
      using errcode = 'P0001';
  end if;

  insert into public.loyalty_ledger_entries
    (account_id, organization_id, program_version_id, entry_type,
     delta_stamps, idempotency_key, redemption_id, actor_user_id)
  values
    (v_account.id, p_organization_id, v_redemption.program_version_id,
     'REDEMPTION', -v_redemption.stamps_spent,
     'redeem:' || v_redemption.id, v_redemption.id, auth.uid());

  update public.loyalty_redemptions
     set status = 'redeemed', confirmed_by = auth.uid(), confirmed_at = now()
   where id = v_redemption.id;

  return query
    select v_redemption.reward_name,
           v_account.stamp_balance - v_redemption.stamps_spent;
end;
$$;

-- Reverse a specific ledger entry (refund handling). Owner/manager only;
-- an entry can be reversed exactly once (partial unique index).
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
  if v_entry.entry_type = 'REVERSAL' then
    raise exception 'a reversal cannot itself be reversed' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to reverse an entry' using errcode = 'P0001';
  end if;

  insert into public.loyalty_ledger_entries
    (account_id, organization_id, program_version_id, entry_type,
     delta_stamps, reason, idempotency_key, reverses_entry_id, actor_user_id)
  values
    (v_entry.account_id, v_entry.organization_id, v_entry.program_version_id,
     'REVERSAL', -v_entry.delta_stamps, trim(p_reason),
     'reverse:' || v_entry.id, v_entry.id, auth.uid());
end;
$$;

-- Small, audited owner-only correction: max ±3 stamps per event, at most
-- 3 events per account per rolling 30 days, reason mandatory.
create or replace function public.loyalty_adjust_balance(
  p_account_id uuid,
  p_delta int,
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
  if p_delta = 0 or abs(p_delta) > 3 then
    raise exception 'manual adjustments are limited to ±3 stamps' using errcode = 'P0001';
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
     delta_stamps, reason, idempotency_key, actor_user_id)
  values
    (p_account_id, v_account.organization_id, v_version_id,
     'MANUAL_ADJUSTMENT', p_delta, trim(p_reason),
     'adjust:' || gen_random_uuid(), auth.uid());
end;
$$;

-- Aggregate program stats for the vendor dashboard (no customer
-- identities beyond what account rows already expose to members).
create or replace function public.loyalty_program_stats(
  p_organization_id uuid
) returns table (
  members int,
  stamps_issued bigint,
  rewards_redeemed bigint,
  outstanding_stamps bigint,
  estimated_liability_cents bigint
)
language plpgsql security definer set search_path = public
as $$
declare
  v_version public.loyalty_program_versions%rowtype;
  v_cost int;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'only members of this organization can view loyalty stats'
      using errcode = '42501';
  end if;
  select * into v_version from public.loyalty_program_versions
   where organization_id = p_organization_id and status = 'active';
  v_cost := coalesce(v_version.reward_est_cost_cents,
                     (coalesce(v_version.reward_retail_value_cents, 0) * 30) / 100);
  return query
    select
      (select count(*)::int from public.loyalty_accounts a
        where a.organization_id = p_organization_id),
      (select coalesce(sum(l.delta_stamps) filter (where l.delta_stamps > 0), 0)
         from public.loyalty_ledger_entries l
        where l.organization_id = p_organization_id),
      (select count(*) from public.loyalty_redemptions r
        where r.organization_id = p_organization_id and r.status = 'redeemed'),
      (select coalesce(sum(a.stamp_balance) filter (where a.stamp_balance > 0), 0)
         from public.loyalty_accounts a
        where a.organization_id = p_organization_id),
      case when v_version.id is null then 0::bigint
           else (select coalesce(sum(a.stamp_balance / v_version.stamps_required), 0) * v_cost
                   from public.loyalty_accounts a
                  where a.organization_id = p_organization_id
                    and a.stamp_balance > 0)
      end;
end;
$$;

grant execute on function public.loyalty_publish_program(uuid, int, int, int, text, int, int, jsonb) to authenticated;
grant execute on function public.loyalty_set_program_paused(uuid, boolean, boolean) to authenticated;
grant execute on function public.loyalty_create_claim_code(uuid) to authenticated;
grant execute on function public.loyalty_confirm_claim(uuid, text) to authenticated;
grant execute on function public.loyalty_request_redemption(uuid) to authenticated;
grant execute on function public.loyalty_confirm_redemption(uuid, text) to authenticated;
grant execute on function public.loyalty_reverse_entry(uuid, text) to authenticated;
grant execute on function public.loyalty_adjust_balance(uuid, int, text) to authenticated;
grant execute on function public.loyalty_program_stats(uuid) to authenticated;
