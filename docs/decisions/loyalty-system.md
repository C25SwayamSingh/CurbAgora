# Decision: CurbAgora Loyalty System

Status: **Accepted** (MVP scope) · Date: 2026-07-18
Owner surface: vendor dashboard → Loyalty · Customer surface: wallet at `/rewards`

## 1. Final architecture (two systems, one boundary)

1. **The Loyalty Engine** — deterministic, append-only, server-side. Every
   stamp, redemption, reversal, and adjustment is a signed integer row in
   `loyalty_ledger_entries`, written only by SECURITY DEFINER SQL functions
   that validate roles, idempotency, and limits. Balances are projections
   of the ledger, never client input.
2. **The Loyalty Advisor** — a consultation layer in the vendor dashboard.
   Its authority is a **deterministic recommendation and economics
   calculator** (pure TypeScript, reviewable inputs → reviewable outputs).
   An optional conversational layer (Anthropic API, env-gated exactly like
   `GOOGLE_PLACES_API_KEY`) may _explain_; it can never issue, redeem,
   publish, or change financial rules. Publishing always flows through an
   owner/manager-authorized server action that re-validates platform
   bounds.

## 2. What verification exists today (and what that forces)

CurbAgora currently has **no orders, payments, menus, POS links, receipts,
QR infra, or phone identification** (verified in-repo). The only
trustworthy purchase witness is the vendor's own authenticated staff at
the counter. Therefore:

- **Earning = staff-confirmed claim.** The customer generates a
  short-lived, single-use claim code in their wallet; an authenticated org
  member enters it and confirms the purchase met the program's qualifying
  minimum. The server validates and writes the stamp. No static QR — codes
  are single-use, expire in 10 minutes, and are bound to
  (customer, organization).
- **Spend-based points are NOT offered in MVP** — rule: _if purchase
  verification is unreliable, do not recommend automatic spend-based
  issuance_. Staff-typed dollar amounts would add fraud surface and
  friction for no benefit at cart scale.
- **Item-based cards are NOT offered in MVP** — there is no menu model to
  bind items to. Rewards are vendor-defined entries (name, retail value,
  estimated marginal cost).
- **Refund reversal is a manual, audited staff/owner action** (no payment
  webhooks exist to automate it).

## 3. Selected templates and the default

**MVP ships one publishable template: the Digital Stamp Card**
(one stamp per qualifying visit, N stamps → one vendor-chosen reward).
It subsumes the visit-based model and approximates the item-based model
through reward choice. It is what a cart's customers already understand,
it survives order-value variability (a $9 taco and a $30 family order both
= one visit), and it is the only template whose earning event is
verifiable today.

Defaults (platform bounds in parentheses):

- stamps required: **6** (4–10)
- qualifying minimum: **$8.00** (vendor-set, $1–$100; guards
  penny-purchase farming)
- stamp frequency: **at most 1 per 4 hours per customer** (floor 1 hour —
  a vendor cannot disable this below the platform minimum)
- first-visit bonus: **+1 stamp on the first-ever qualifying visit**
  (endowed progress: "you're already 2 of 6"), hard-uniqued per
  customer×vendor so account games can't repeat it; reversed if the
  underlying visit is reversed
- reward: vendor-defined item; retail value + estimated cost captured for
  economics
- reward expiry: **none in MVP** (breakage-by-expiry is a chain tactic
  that erodes neighborhood trust; revisit only with real data)
- tiers/status: **deferred** — "Regular" status is a v2 layer once earn
  volume exists.

**Deferred templates and their unlock conditions:**

- Spend-based points → unblocks when verified order totals exist
  (payments/POS). Display rule when built: 1 point per eligible dollar,
  never inflated scales.
- Item/category card → unblocks when menus exist.
- Hybrid + slow-hour bonuses → after ≥30 days of ledger data (the
  promotions engine, Phase 17, is deferred with it).
- CurbAgora Credits (platform-funded) → **explicitly deferred.** No
  cross-vendor value in MVP; one vendor's stamps are redeemable only with
  that vendor. No settlement system exists, so nothing may pretend one
  does.

## 4. Economics model (integer cents, no floats)

For a stamp program the calculator reports, with every recommendation:

- qualifying spend to reward = `stamps_required × typical_order_cents`
  (bonus-adjusted: `(stamps_required − 1)` for the first card because of
  the first-visit bonus)
- customer-perceived rate = `reward_retail_cents / qualifying_spend`
- vendor cost rate = `reward_est_cost_cents / qualifying_spend`
- expected monthly cost = `regulars_per_month × completion_rate ×
reward_est_cost_cents` (completion shown as a labeled assumption range
  of 40–70%, not a fact)
- worst case = 100% completion
- outstanding liability = `floor(outstanding_stamps / stamps_required) ×
reward_est_cost_cents` (plus partial-progress exposure shown separately)

When the vendor cannot supply cost data, the calculator assumes
**cost ≈ 30% of retail**, and every screen that uses it says "estimated —
you haven't entered your cost". Estimates are never presented as facts.

Guardrails (enforced at publish time, server-side — not advisory):

- vendor cost rate > 10% → publication blocked
- vendor cost rate > 5% → strong warning
- stamps required > 10 → blocked; 9–10 → disengagement warning
- stamps required < 4 → cost/abuse warning
- qualifying minimum below $1 → blocked

Why chain mechanics are rejected as defaults: a 200-points-per-dollar
scale hides value, assumes breakage a family business can't bank on, and
requires a redemption catalog nobody at a cart will maintain. A cart's
edge is _recognition_ — "one more visit and your drink's on us" — and a
high-perceived-value / low-marginal-cost item reward routinely delivers
~5% perceived value at ~1–2% real cost, which a cash discount cannot.

## 5. Fraud model

- Claim codes: single-use, 10-minute TTL, one active per account, max 10
  creations per account per day, bound to customer×org, confirmed only by
  an authenticated member of that org.
- Stamp frequency floor (≥1h) and program qualifying minimum.
- Idempotency: every ledger entry carries a unique idempotency key; claim
  and redemption confirmations are keyed by their row ids.
- Redemptions: reservation row (15-min TTL, one open per account) →
  staff confirms → balance re-checked under `FOR UPDATE` → ledger debit in
  the same transaction. Concurrent double-spend is structurally impossible.
- Manual adjustments: owner-only, ±3 stamps max per event, ≤3 events per
  account per month, reason required, distinct ledger event type.
- Reversals: linked to the original entry (`reverses_entry_id`), may drive
  a balance negative (refund after redemption); recovery happens through
  future earning. Negative balances are visible, never silently dropped.
- The append-only trigger rejects every UPDATE/DELETE on the ledger.

## 6. Versioning, pause, shutdown

- Rule changes create a new `loyalty_program_versions` row; exactly one
  ACTIVE version per program (partial unique index). Ledger entries and
  redemptions record the version they executed under.
- Stamps are version-independent progress: raising `stamps_required`
  never erases stamps (the UI warns the owner it slows existing
  customers; lowering it can make customers instantly eligible — shown
  before publish).
- Pause earning: new claims rejected; balances intact; redemptions still
  honored. Pause redemptions (closure prep): separately controllable.
  A vendor cannot zero balances by editing settings — there is no code
  path that deletes ledger history.
- Org leaves platform: balances remain in the ledger (audit), customer
  wallet marks the program inactive.

## 7. Advisor (consultation → recommendation → owner approval)

Structured consultation (each question offers "help me estimate" / skip):
typical order total; how often regulars return; primary goal (more
repeat visits / slow hours / new item); candidate rewards with retail +
optional cost; monthly reward budget; busy-day redemption capacity;
simplicity preference; existing system (paper card / Square / none).

Deterministic recommender then ranks 2–3 stamp configurations (e.g. 5 / 6
/ 8 stamps with different rewards), each showing: exact earn rule, exact
reward, visits & spend to reward, perceived value %, estimated cost %,
monthly exposure, risks, refund behavior, pause behavior — computed by the
calculator above, using only inputs shown on screen. "Use this" prefills
the publish form; only an owner/manager action publishes, and the server
re-validates every bound.

Rules of the rule engine (reviewable, in `advisor.ts`): goal=slow-hours →
note the promotions layer is post-MVP and optimize visit frequency now;
budget too low for any config → recommend cheaper reward, never a worse
program silently; no cost data → conservative configs + uncertainty
labels; existing Square/Toast loyalty → recommend complement-don't-replace
and say why (migration confusion), CurbAgora card focused on
discovery-driven new regulars.

The optional LLM layer receives only: the vendor's consultation answers,
the deterministic outputs, and aggregate program stats — never customer
identities, contact info, or other vendors' data. Its system prompt
forbids financial promises and instructs it to defer to the calculator's
numbers. Absent `ANTHROPIC_API_KEY`, the UI simply doesn't offer free-form
Q&A (dev-fallback pattern identical to Places).

## 8. Rollout & metrics

Phase 1 (this build): stamp engine + advisor + wallet, staff-confirmed
claims. Phase 1.1: reversal UX polish, "regulars" aggregate view, LLM Q&A
verified with a key. Phase 2: promotions with caps, endowed-progress
experiments, platform benchmarks (only after enough vendors that no
single vendor is identifiable). Phase 3: spend/item templates on top of
real orders/menus.

Track: enrollment rate, first→second visit conversion, median visits to
first reward, completion rate, redemption latency, outstanding liability,
realized cost rate, manual-adjustment volume, suspected-fraud flags
(velocity rejections), advisor acceptance rate. Causality caveat is
mandatory in vendor-facing analytics copy: loyal customers spend more
partly because they were already loyal — pre/post and matched comparisons
only, no uplift guarantees.

## 9. Assumptions needing real-vendor validation

- $8 default qualifying minimum and 6-stamp default length fit actual
  cart order distributions.
- Staff have time to type a 6-character code at rush hour (v1.1: camera
  QR scan of the same claim).
- 30%-of-retail cost fallback is conservative enough across cuisines.
- First-visit bonus meaningfully improves second-visit conversion
  (endowed-progress literature says yes; measure it).
- Completion-rate band (40–70%) for liability planning.
