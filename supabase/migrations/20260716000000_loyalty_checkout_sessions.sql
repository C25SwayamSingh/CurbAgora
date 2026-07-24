-- ============================================================================
-- Loyalty: QR + rotating 4-digit checkout identification
-- ============================================================================
-- Replaces the 6-character, read-it-aloud code with a temporary CHECKOUT
-- SESSION that a customer can present two equivalent ways:
--
--   1. a dynamic QR code   (opaque token; only its SHA-256 digest is stored)
--   2. a 4-digit numeric code (spoken fallback, unique among active sessions)
--
-- Both identify the SAME session row. Neither awards anything: identification
-- and value are deliberately separate steps. Points are still only created by
-- a staff member entering a verified eligible subtotal from the register.
--
-- The session table is public.loyalty_claim_codes, EXTENDED rather than
-- replaced: it already models a short-lived, one-time, org-scoped,
-- account-tied artifact, loyalty_ledger_entries.claim_code_id references it,
-- and its RLS + partial unique indexes are already correct. Building a
-- parallel table would have orphaned that audit trail.
--
-- Status vocabulary (existing lowercase values preserved so historical rows
-- and their ledger references stay valid):
--   pending   -> ACTIVE
--   confirmed -> CONSUMED
--   expired   -> EXPIRED
--   cancelled -> CANCELLED
--   locked    -> LOCKED   (new)
--
-- Forward-only. No rows are deleted, no ledger entry is touched, and the
-- append-only trigger is left exactly as it was.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend the session table
-- ---------------------------------------------------------------------------

alter table public.loyalty_claim_codes
  add column if not exists numeric_code text,
  add column if not exists token_digest text,
  add column if not exists vendor_unit_id uuid
    references public.vendor_units (id) on delete set null,
  add column if not exists failed_attempts int not null default 0,
  add column if not exists invalidated_reason text;

-- Nullable throughout: legacy rows predate both columns and must stay valid.
alter table public.loyalty_claim_codes
  drop constraint if exists loyalty_claim_codes_numeric_code_format;
alter table public.loyalty_claim_codes
  add constraint loyalty_claim_codes_numeric_code_format
  check (numeric_code is null or numeric_code ~ '^[0-9]{4}$');

alter table public.loyalty_claim_codes
  drop constraint if exists loyalty_claim_codes_token_digest_format;
alter table public.loyalty_claim_codes
  add constraint loyalty_claim_codes_token_digest_format
  check (token_digest is null or token_digest ~ '^[0-9a-f]{64}$');

-- The 6-character legacy code is no longer issued, so new rows leave it null.
alter table public.loyalty_claim_codes alter column code drop not null;
alter table public.loyalty_claim_codes
  drop constraint if exists loyalty_claim_codes_code_check;
alter table public.loyalty_claim_codes
  add constraint loyalty_claim_codes_code_check
  check (code is null or code ~ '^[A-HJ-NP-Z2-9]{6}$');

-- Every session must be identifiable by at least one method.
alter table public.loyalty_claim_codes
  drop constraint if exists loyalty_claim_codes_identifiable;
alter table public.loyalty_claim_codes
  add constraint loyalty_claim_codes_identifiable
  check (code is not null or (numeric_code is not null and token_digest is not null));

alter table public.loyalty_claim_codes
  drop constraint if exists loyalty_claim_codes_status_check;
alter table public.loyalty_claim_codes
  add constraint loyalty_claim_codes_status_check
  check (status in ('pending', 'confirmed', 'cancelled', 'expired', 'locked'));

-- Only 10,000 numeric codes exist, so uniqueness is scoped to what is live in
-- one organization at one moment. Consumed/expired codes are free to recur.
create unique index if not exists loyalty_claim_codes_open_numeric_code
  on public.loyalty_claim_codes (organization_id, numeric_code)
  where status = 'pending' and numeric_code is not null;

-- The QR token is globally unique: a digest collision must never resolve.
create unique index if not exists loyalty_claim_codes_token_digest_key
  on public.loyalty_claim_codes (token_digest)
  where token_digest is not null;

comment on column public.loyalty_claim_codes.token_digest is
  'SHA-256 hex of the opaque QR token. The raw token is generated in the '
  'server action and NEVER stored — a database reader cannot reconstruct a '
  'scannable code.';
comment on column public.loyalty_claim_codes.numeric_code is
  'Spoken 4-digit fallback for the same session. Unique only among pending '
  'sessions in one organization; rate limiting, not entropy, is the defense.';
comment on column public.loyalty_claim_codes.vendor_unit_id is
  'Which cart the customer opened this from. Audit context only — loyalty '
  'programs are per-organization, so this never scopes eligibility.';

-- ---------------------------------------------------------------------------
-- 2. Column-level grants: secrets stop being readable over PostgREST
-- ---------------------------------------------------------------------------
-- No application code selects this table directly (every path is a SECURITY
-- DEFINER function), so narrowing the grant costs nothing and stops a signed-in
-- staff member from enumerating live codes through the REST API.

revoke select on public.loyalty_claim_codes from authenticated;
grant select (
  id, account_id, organization_id, vendor_unit_id, status,
  expires_at, confirmed_by, confirmed_at, created_at,
  failed_attempts, invalidated_reason
) on public.loyalty_claim_codes to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Lookup audit log
-- ---------------------------------------------------------------------------
-- Every resolve attempt is recorded, successful or not. This is what makes
-- "repeated wrong guesses" observable rather than silent.

create table if not exists public.loyalty_checkout_lookups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  method text not null check (method in ('qr', 'code4')),
  outcome text not null
    check (outcome in ('resolved', 'not_found', 'expired', 'consumed', 'throttled')),
  session_id uuid references public.loyalty_claim_codes (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists loyalty_checkout_lookups_throttle_idx
  on public.loyalty_checkout_lookups (organization_id, actor_user_id, created_at desc);

comment on table public.loyalty_checkout_lookups is
  'Audit trail of customer-identification attempts. Deliberately stores no '
  'customer identity and never the attempted code value — only who tried, '
  'against which org, by which method, and how it ended.';

alter table public.loyalty_checkout_lookups enable row level security;

drop policy if exists "loyalty_checkout_lookups_select_member"
  on public.loyalty_checkout_lookups;
create policy "loyalty_checkout_lookups_select_member"
  on public.loyalty_checkout_lookups for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());

-- Select only: writes happen exclusively inside the definer function below.
grant select on public.loyalty_checkout_lookups to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Customer opens a checkout session
-- ---------------------------------------------------------------------------
-- The caller supplies the token DIGEST (the raw token stays in the server
-- action) and a list of cryptographically random 4-digit candidates. Picking
-- the first free candidate makes collision handling deterministic — no
-- retry-with-new-randomness loop inside the transaction.

create or replace function public.loyalty_start_checkout_session(
  p_organization_id uuid,
  p_vendor_unit_id uuid,
  p_token_digest text,
  p_code_candidates text[]
) returns table (session_id uuid, numeric_code text, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id uuid;
  v_program public.loyalty_programs%rowtype;
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
  if not exists (select 1 from public.loyalty_program_versions v
                  where v.program_id = v_program.id and v.status = 'active') then
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

-- ---------------------------------------------------------------------------
-- 5. Staff resolves a session (identification only — never consumes)
-- ---------------------------------------------------------------------------

-- A failed lookup RETURNS its outcome rather than raising it. That is not a
-- style preference: `raise` aborts the transaction, which would roll back the
-- very audit row that records the attempt, leaving the rate limiter counting
-- rows that never persist. Expected business outcomes are values here;
-- exceptions are reserved for authorization violations, which must abort.
drop function if exists public.loyalty_resolve_checkout_session(uuid, text, text);

create function public.loyalty_resolve_checkout_session(
  p_organization_id uuid,
  p_method text,
  p_value text
) returns table (
  outcome text,
  session_id uuid,
  display_name text,
  member_ref text,
  point_balance int,
  expires_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.loyalty_claim_codes%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_failures int;
  v_name text;
  v_outcome text;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'only members of this organization can identify customers'
      using errcode = '42501';
  end if;
  if p_method not in ('qr', 'code4') then
    raise exception 'unsupported identification method' using errcode = 'P0001';
  end if;

  -- Only the 4-digit path is throttled. It is the guessable one: 10,000
  -- values, walkable by a determined staff account. A QR token is 256 bits of
  -- entropy, so rate-limiting it would buy nothing and would strand a busy
  -- vendor who had just fat-fingered a few codes — the scanner must keep
  -- working for the real customer standing at the counter.
  select count(*) into v_failures
    from public.loyalty_checkout_lookups l
   where l.organization_id = p_organization_id
     and l.actor_user_id = auth.uid()
     and l.method = 'code4'
     and l.outcome <> 'resolved'
     and l.created_at > now() - interval '10 minutes';

  if p_method = 'code4' and v_failures >= 10 then
    insert into public.loyalty_checkout_lookups
      (organization_id, actor_user_id, method, outcome)
    values (p_organization_id, auth.uid(), p_method, 'throttled');
    return query select 'throttled'::text, null::uuid, null::text, null::text,
                        null::int, null::timestamptz;
    return;
  end if;

  if p_method = 'qr' then
    select * into v_session from public.loyalty_claim_codes c
     where c.organization_id = p_organization_id
       and c.token_digest = p_value
     for update;
  else
    select * into v_session from public.loyalty_claim_codes c
     where c.organization_id = p_organization_id
       and c.numeric_code = p_value
       and c.status = 'pending'
     for update;
  end if;

  if not found then
    insert into public.loyalty_checkout_lookups
      (organization_id, actor_user_id, method, outcome)
    values (p_organization_id, auth.uid(), p_method, 'not_found');
    return query select 'not_found'::text, null::uuid, null::text, null::text,
                        null::int, null::timestamptz;
    return;
  end if;

  if v_session.status <> 'pending' or v_session.expires_at < now() then
    v_outcome := case when v_session.status = 'confirmed'
                      then 'consumed' else 'expired' end;
    -- Aliased: `expires_at` is also an OUT parameter of this function.
    update public.loyalty_claim_codes c
       set failed_attempts = c.failed_attempts + 1,
           status = case
                      when c.failed_attempts + 1 >= 5 and c.status = 'pending'
                        then 'locked'
                      when c.status = 'pending' and c.expires_at < now()
                        then 'expired'
                      else c.status
                    end,
           invalidated_reason = case
                      when c.failed_attempts + 1 >= 5 and c.status = 'pending'
                        then 'too_many_attempts'
                      when c.status = 'pending' and c.expires_at < now()
                        then 'timed_out'
                      else c.invalidated_reason
                    end
     where c.id = v_session.id;
    insert into public.loyalty_checkout_lookups
      (organization_id, actor_user_id, method, outcome, session_id)
    values (p_organization_id, auth.uid(), p_method, v_outcome, v_session.id);
    return query select v_outcome, null::uuid, null::text, null::text,
                        null::int, null::timestamptz;
    return;
  end if;

  select * into v_account from public.loyalty_accounts a where a.id = v_session.account_id;
  select p.display_name into v_name from public.profiles p where p.id = v_account.user_id;

  insert into public.loyalty_checkout_lookups
    (organization_id, actor_user_id, method, outcome, session_id)
  values (p_organization_id, auth.uid(), p_method, 'resolved', v_session.id);

  -- Only what a staff member needs to be confident they have the right person:
  -- a name they can greet, a masked reference, and the balance for this vendor.
  -- No email, no phone, no full identifier, no other vendors' balances.
  return query select
    'resolved'::text,
    v_session.id,
    nullif(trim(coalesce(v_name, '')), ''),
    '•' || right(replace(v_account.id::text, '-', ''), 4),
    v_account.point_balance,
    v_session.expires_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Staff awards points against a resolved session
-- ---------------------------------------------------------------------------
-- Consume + ledger insert happen in one statement pair inside one transaction:
-- any raise below rolls the whole thing back, so a failed award can never
-- leave a half-consumed session.

create or replace function public.loyalty_award_points(
  p_organization_id uuid,
  p_session_id uuid,
  p_eligible_subtotal_cents int
) returns table (points_awarded int, point_balance int)
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.loyalty_claim_codes%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_version public.loyalty_program_versions%rowtype;
  v_points int;
  v_balance int;
  v_recent int;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'only members of this organization can award points'
      using errcode = '42501';
  end if;

  -- Platform-enforced sanity bounds on the staff-entered amount. A customer
  -- never supplies this; a staff member reads it from the register.
  if p_eligible_subtotal_cents is null or p_eligible_subtotal_cents <= 0 then
    raise exception 'enter the eligible subtotal' using errcode = 'P0001';
  end if;
  if p_eligible_subtotal_cents > 100000 then
    raise exception 'that amount looks too large (max $1,000 per purchase); re-enter it'
      using errcode = 'P0001';
  end if;

  -- Re-validate everything from scratch under a row lock. The resolve step is
  -- advisory only: a session that expired or was consumed in the seconds since
  -- must still be refused here.
  select * into v_session from public.loyalty_claim_codes
   where id = p_session_id
     and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'that checkout code was not recognized' using errcode = 'P0001';
  end if;
  if v_session.status = 'confirmed' then
    raise exception 'that code was already used — ask the customer for a fresh one'
      using errcode = 'P0001';
  end if;
  if v_session.status <> 'pending' then
    raise exception 'that code is no longer valid — ask the customer to refresh it'
      using errcode = 'P0001';
  end if;
  if v_session.expires_at < now() then
    update public.loyalty_claim_codes c
       set status = 'expired', invalidated_reason = 'timed_out'
     where c.id = v_session.id;
    raise exception 'that code has expired — ask the customer to refresh it'
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
   where l.account_id = v_session.account_id
     and l.entry_type = 'PURCHASE_POINTS'
     and l.created_at > now() - interval '1 hour';
  if v_recent >= 6 then
    raise exception 'too many purchases confirmed for this customer in the last hour'
      using errcode = 'P0001';
  end if;

  -- Integer-only: cents × points-per-dollar ÷ 100, floored by integer division.
  v_points := (p_eligible_subtotal_cents * v_version.points_per_dollar) / 100;
  if v_points <= 0 then
    raise exception 'that purchase is below the amount needed to earn a point'
      using errcode = 'P0001';
  end if;

  -- The idempotency key is the session itself, so a double submission hits the
  -- unique constraint rather than paying out twice.
  insert into public.loyalty_ledger_entries
    (account_id, organization_id, program_version_id, entry_type,
     delta_points, verified_subtotal_cents, idempotency_key,
     claim_code_id, actor_user_id)
  values
    (v_session.account_id, p_organization_id, v_version.id, 'PURCHASE_POINTS',
     v_points, p_eligible_subtotal_cents, 'claim:' || v_session.id,
     v_session.id, auth.uid());

  update public.loyalty_claim_codes
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
   where id = v_session.id;

  select a.point_balance into v_balance
    from public.loyalty_accounts a where a.id = v_session.account_id;

  return query select v_points, v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Customer cancels their own session ("Refresh code")
-- ---------------------------------------------------------------------------

create or replace function public.loyalty_cancel_checkout_session(
  p_session_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
begin
  select a.user_id into v_owner
    from public.loyalty_claim_codes c
    join public.loyalty_accounts a on a.id = c.account_id
   where c.id = p_session_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'you can only cancel your own checkout code' using errcode = '42501';
  end if;
  update public.loyalty_claim_codes
     set status = 'cancelled', invalidated_reason = 'refreshed'
   where id = p_session_id and status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Customer polls their own session for the confirmation moment
-- ---------------------------------------------------------------------------

create or replace function public.loyalty_checkout_session_status(
  p_session_id uuid
) returns table (
  status text,
  expires_at timestamptz,
  points_awarded int,
  point_balance int
)
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.loyalty_claim_codes%rowtype;
  v_owner uuid;
begin
  select * into v_session from public.loyalty_claim_codes where id = p_session_id;
  if not found then
    raise exception 'checkout code not found' using errcode = 'P0001';
  end if;
  select a.user_id into v_owner
    from public.loyalty_accounts a where a.id = v_session.account_id;
  if v_owner <> auth.uid() then
    raise exception 'you can only check your own checkout code' using errcode = '42501';
  end if;

  return query
    select
      case when v_session.status = 'pending' and v_session.expires_at < now()
           then 'expired' else v_session.status end,
      v_session.expires_at,
      coalesce((select l.delta_points from public.loyalty_ledger_entries l
                 where l.claim_code_id = v_session.id
                   and l.entry_type = 'PURCHASE_POINTS'
                 limit 1), 0),
      (select a.point_balance from public.loyalty_accounts a
        where a.id = v_session.account_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Retire the superseded 6-character earning path
-- ---------------------------------------------------------------------------
-- Existing rows, their ledger references, and redemption codes are untouched;
-- only the functions that ISSUED and CONSUMED 6-character earning codes go.
-- loyalty_request_redemption / loyalty_confirm_redemption keep their own
-- 6-character codes — redemption is deliberately out of scope here.

drop function if exists public.loyalty_create_claim_code(uuid);
drop function if exists public.loyalty_confirm_purchase(uuid, text, int);

revoke all on function public.loyalty_start_checkout_session(uuid, uuid, text, text[]) from public;
revoke all on function public.loyalty_resolve_checkout_session(uuid, text, text) from public;
revoke all on function public.loyalty_award_points(uuid, uuid, int) from public;
revoke all on function public.loyalty_cancel_checkout_session(uuid) from public;
revoke all on function public.loyalty_checkout_session_status(uuid) from public;

grant execute on function public.loyalty_start_checkout_session(uuid, uuid, text, text[]) to authenticated;
grant execute on function public.loyalty_resolve_checkout_session(uuid, text, text) to authenticated;
grant execute on function public.loyalty_award_points(uuid, uuid, int) to authenticated;
grant execute on function public.loyalty_cancel_checkout_session(uuid) to authenticated;
grant execute on function public.loyalty_checkout_session_status(uuid) to authenticated;
