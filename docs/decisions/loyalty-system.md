# Decision: CurbAgora Loyalty System

Status: **Accepted** (MVP scope) · Date: 2026-07-18
Owner surface: vendor dashboard → Loyalty · Customer surface: wallet at `/rewards`

## 1. Final architecture (two systems, one boundary)

1. **The Loyalty Engine** — deterministic, append-only, server-side. Every
   purchase, redemption, reversal, and adjustment is a signed integer row in
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

CurbAgora has **no orders, payments, menus, POS links, or receipts**
(verified in-repo). The only trustworthy purchase witness is the vendor's
own authenticated staff at the counter. Therefore:

- **Earning = staff-verified subtotal.** The customer presents a
  short-lived checkout identity (§10); an authenticated org member reads
  the register and enters the eligible subtotal. The server computes
  `floor(cents × points_per_dollar / 100)` and writes the ledger entry.
- **The customer never types an amount.** This is the hard rule the whole
  design protects. No scan, sticker, or self-report can create value.
- **Item-based cards are NOT offered** — there is no menu model to bind
  items to. Rewards are vendor-defined catalog entries (name, kind, retail
  value, estimated marginal cost).
- **Refund reversal is a manual, audited staff/owner action** (no payment
  webhooks exist to automate it).

## 3. Selected templates and the default

**The model is spend-based points with a controlled reward catalog.**
Verified dollars spent → points earned → vendor-defined rewards priced in
points. This replaced the original Digital Stamp Card outright; stamps,
visits, punch cards, and the first-visit stamp bonus are gone and must not
return.

Why the change: a stamp treats a $9 taco and a $30 family order as the same
event, which under-rewards exactly the customers a cart most wants back. A
points scale is proportional to what someone actually spends, and it is the
pattern every major chain has already taught customers to read.

Defaults (platform bounds in parentheses):

- points per dollar: **10** (1–100)
- catalog size: 1–6 rewards per program version
- reward kinds: **`FREE_ITEM`** (menu price ≫ marginal cost — real cost
  leverage) and **`FIXED_DISCOUNT`** (costs full face value, no leverage)
- reward expiry: **none** (breakage-by-expiry is a chain tactic that erodes
  neighborhood trust; revisit only with real data)
- purchase velocity: at most **6 confirmed purchases per customer per hour**
- subtotal sanity bound: **$1,000** per purchase
- tiers/status: **deferred** — a "Regular" tier is a later layer once earn
  volume exists.

**Deferred and their unlock conditions:**

- Automatic earning without staff → unblocks with CurbAgora ordering or a
  POS integration (§10).
- Item/category rewards → unblocks when menus exist.
- Bonus-point campaigns and slow-hour promotions → after ≥30 days of ledger
  data.
- CurbAgora Credits (platform-funded) → **explicitly deferred.** One
  vendor's points are redeemable only with that vendor. No settlement
  system exists, so nothing may pretend one does.

## 4. Economics model (integer cents, no floats)

Per catalog tier, the calculator reports:

- spend to earn = `points_cost ÷ points_per_dollar` dollars, in cents
- customer-perceived rate = `reward_value_cents / spend_to_earn`
- vendor cost rate = `reward_est_cost_cents / spend_to_earn`
- expected monthly cost = `regulars_per_month × completion_rate ×
reward_est_cost_cents` (completion shown as a labeled assumption range
  of 40–70%, not a fact)
- worst case = 100% completion
- outstanding liability from unredeemed balances, with partial progress
  shown separately

A `FIXED_DISCOUNT` is costed at **full face value** — the 30% fallback
never applies to it, because a dollar off is a dollar of revenue foregone.
When a vendor cannot supply cost data for a `FREE_ITEM`, the calculator
assumes **cost ≈ 30% of retail** and every screen says "estimated — you
haven't entered your cost". Estimates are never presented as facts.

Guardrails (enforced at publish time, server-side, **per tier** — not
advisory):

- vendor cost rate > 10% → publication blocked
- vendor cost rate > 5% → strong warning
- points per dollar outside 1–100 → blocked
- empty catalog → blocked
- entry reward beyond ~$80 of spend → blocked as unreachable (premium tiers
  may sit further out; the _first_ reward may not)

The advisor prices each reward to land near **8% perceived value** while
holding vendor cost under 5%, rounded to clean multiples of 50 points. Why
not chain-style scales: a 200-points-per-dollar scale hides value and banks
on breakage a family business cannot. A high-perceived-value /
low-marginal-cost item reward routinely delivers strong perceived value at
1–2% real cost, which a cash discount cannot.

## 5. Fraud model

- Checkout sessions: single-use, 5-minute TTL, one active per account, max
  30 per account per day, bound to customer×org, consumed only by an
  authenticated member of that org. See §10 for the full model.
- Purchase velocity ceiling: 6 confirmed purchases per customer per hour.
- Idempotency: every ledger entry carries a unique idempotency key; claim
  and redemption confirmations are keyed by their row ids.
- Redemptions: reservation row (15-min TTL, one open per account) →
  staff confirms → balance re-checked under `FOR UPDATE` → ledger debit in
  the same transaction. Concurrent double-spend is structurally impossible.
- Manual adjustments: owner-only, ±2000 points max per event, ≤3 events per
  account per month, reason required, distinct ledger event type.
- Reversals: linked to the original entry (`reverses_entry_id`), may drive
  a balance negative (refund after redemption); recovery happens through
  future earning. Negative balances are visible, never silently dropped.
- The append-only trigger rejects every UPDATE/DELETE on the ledger.

## 6. Versioning, pause, shutdown

- Rule changes create a new `loyalty_program_versions` row; exactly one
  ACTIVE version per program (partial unique index). Ledger entries and
  redemptions record the version they executed under.
- Point balances are version-independent: republishing with a different
  scale or catalog never erases points. Repricing a reward can make
  existing customers instantly eligible — shown before publish.
- Pause earning: new checkout sessions rejected; balances intact;
  redemptions still honored. Pause redemptions (closure prep): separately controllable.
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

The deterministic recommender then ranks up to three structurally distinct
catalog **shapes** — `single` (one reward), `ladder` (a reachable entry
reward plus an aspirational one), and `full` (a three-plus catalog) — each
showing: points per dollar, each reward's points price, spend to earn,
perceived value %, estimated cost %, monthly exposure, risks, refund
behavior, and pause behavior, computed by the calculator above using only
inputs shown on screen. Rewards it cannot price safely are listed as
**visible exclusions with the arithmetic**, never dropped silently. "Use
this" prefills the publish form; only an owner/manager action publishes,
and the server re-validates every bound.

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

Phase 1 (this build): points engine + reward catalog + advisor + wallet,
staff-verified subtotals, QR/4-digit checkout identification. Phase 1.1:
reversal UX polish, "regulars" aggregate view, LLM Q&A verified with a key,
redemption over the same checkout identity (§10). Phase 2: bonus-point
campaigns with caps, status tiers, platform benchmarks (only after enough
vendors that no single vendor is identifiable). Phase 3: POS or
CurbAgora-native ordering, removing the last manual step.

Track: enrollment rate, first→second visit conversion, median visits to
first reward, completion rate, redemption latency, outstanding liability,
realized cost rate, manual-adjustment volume, suspected-fraud flags
(velocity rejections), advisor acceptance rate. Causality caveat is
mandatory in vendor-facing analytics copy: loyal customers spend more
partly because they were already loyal — pre/post and matched comparisons
only, no uplift guarantees.

## 9. Assumptions needing real-vendor validation

- The 10-points-per-dollar default reads as meaningful progress rather than
  play money.
- 30%-of-retail cost fallback is conservative enough across cuisines.
- Completion-rate band (40–70%) for liability planning.
- Five minutes is long enough for a customer to open a code and reach the
  front of the line, and short enough that a screenshot is worthless.
- A one-person cart operator prefers scanning to typing under rush
  conditions (both are built; measure which gets used).

## 10. Checkout identification: two QRs, one 4-digit fallback

CurbAgora uses two QR codes that look alike and do entirely different jobs.
Conflating them is the mistake this section exists to prevent.

### Permanent vendor QR

One per vendor unit, printed once and left up: on the cart, counter, menu,
signage, packaging. It encodes nothing but a public URL —
`/vendors/{orgSlug}/{unitSlug}/rewards` — which is why it can survive a year
outdoors and be photographed by anyone.

**It never awards points.** Scanning a sticker proves someone stood near a
cart; it proves nothing about a purchase. It routes: sign-in if needed, then
straight to the customer's checkout screen for that vendor. Managed at
`/vendor/unit/[id]/qr` (owner/manager), with PNG/SVG download and the
suggested print line "Scan to join rewards".

### Dynamic customer QR + 4-digit code

Both identify the _same_ short-lived checkout session. The customer picks
neither — staff does, based on whichever is faster in the moment.

| Property      | Value                                                     |
| ------------- | --------------------------------------------------------- |
| Lifetime      | 5 minutes                                                 |
| Uses          | Exactly one                                               |
| QR payload    | `curbagora:c1:<43-char base64url token>`                  |
| Token entropy | 256 bits (`randomBytes(32)`)                              |
| Stored form   | SHA-256 digest only — the raw token is never written down |
| 4-digit code  | Unique among _active_ sessions in one organization        |
| Rotation      | On expiry, consumption, manual refresh, or replacement    |

The QR carries no customer UUID, account id, email, phone, name, or balance.
A database reader cannot reconstruct a scannable code, because only the
digest is persisted. The 4-digit code is a lookup handle, never an
authenticator.

### Why staff still enters the subtotal

Identification and value are deliberately separate steps. Nothing a customer
can display — sticker, QR, or spoken digits — is evidence that money changed
hands. Only a staff member reading the register knows the eligible subtotal,
so that is who enters it. The customer never types an amount; the browser's
points preview is cosmetic and the server recomputes from cents.

### Replay and brute-force prevention

- Consume + ledger insert happen under one `FOR UPDATE` lock in one
  transaction. A raise anywhere rolls back both, so a failed award never
  half-consumes a session.
- The idempotency key is the session id, so a double submission collides on
  a unique constraint rather than paying twice.
- `loyalty_award_points` re-validates expiry, status, program, and velocity
  from scratch — a stale identification cannot award.
- **Failed lookups are returned, not raised.** This is load-bearing: an
  exception would roll back the audit row recording the attempt, leaving the
  rate limiter counting rows that never persisted. Authorization violations
  still raise, because those must abort.
- Ten failed 4-digit lookups per staff account per organization per ten
  minutes triggers a throttle. Only the 4-digit path is throttled — a
  256-bit QR token is not guessable, and rate-limiting it would strand a
  vendor mid-queue for no security gain.
- Five failed lookups against one session lock it.

### Camera behavior

`getUserMedia` is reached only from an explicit tap, never on page load. The
rear camera is preferred. Decoding is local — `BarcodeDetector` where it
exists, a lazily-imported `jsqr` where it doesn't (notably iOS Safari) — and
only the decoded token is sent. **No frame ever leaves the device.** Every
exit path stops all MediaStream tracks: success, cancel, unmount,
navigation, error, and tab-hide. Denied, missing, in-use, unsupported, and
insecure-origin all fall through to the 4-digit method, which stays visible
throughout.

### Privacy at the counter

Resolving a session shows staff a display name (if set), a masked
`Member •4821`, and this vendor's balance. Never email, phone, a complete
identifier, other vendors' balances, or account history.

### Legacy 6-character codes

Historical `loyalty_claim_codes` rows and their `claim_code_id` ledger
references are preserved untouched. The two functions that issued and
consumed 6-character _earning_ codes are dropped; the format is no longer
issued. Redemption keeps its own separate 6-character code, unchanged.

### Deferred: redemption via the same identity

The checkout session could safely identify a customer for redemption too.
The recommended future flow: staff identifies the customer → the screen
shows only rewards that customer can currently afford → **the customer
selects** → staff confirms and hands it over. Identification must never
auto-redeem: being recognized is not the same as choosing to spend a
balance. Not built in this phase.

### Future: POS integration and wallets

The staff-entered subtotal is the honest ceiling of what this architecture
can verify without integration. A POS integration (or CurbAgora-native
ordering) would replace the typed amount with a verified order total and
remove the last manual step — at which point identification could happen
once at order time rather than at the counter. Apple Wallet / Google Wallet
passes are a plausible later home for the dynamic code, since both support
rotating barcodes; that would remove the "open the app" step entirely.

### Current limitations

- Points require a staff member present and paying attention.
- A dishonest staff member can still enter a wrong subtotal; the ledger
  records who did it, which is deterrence, not prevention.
- The 4-digit code is only unique among _active_ sessions in one
  organization — it is not, and must not be used as, a member number.
- Confirmation is polled every 3s, so the customer sees the award within a
  few seconds rather than instantly.
