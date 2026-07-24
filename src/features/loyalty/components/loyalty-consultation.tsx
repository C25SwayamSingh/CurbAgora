"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { SubmitButton } from "@/features/authentication/components/submit-button";
import { publishLoyaltyProgramAction } from "@/features/loyalty/actions";
import { ADVISOR_MODEL_LABEL } from "@/features/loyalty/advisor-model";
import {
  CHAIN_BENCHMARKS,
  DEFAULT_STANCE,
  bandFor,
  placeAgainstChains,
} from "@/features/loyalty/benchmarks";
import {
  VISIT_CADENCE_LABEL,
  existingSystemGuidance,
  recommendPrograms,
  type AdvisorResult,
  type ConsultationAnswers,
  type ExistingSystem,
  type ExistingSystemGuidance,
  type LoyaltyGoal,
  type LoyaltyRecommendation,
  type VisitCadence,
} from "@/features/loyalty/advisor";
import {
  formatBps,
  formatCents,
  formatPoints,
  type RewardKind,
  type RewardSpec,
} from "@/features/loyalty/engine";
import {
  INPUT_MODE_LABEL,
  parseMoneyStrict,
  resolveCountField,
  resolveMoneyField,
  type InputMode,
} from "@/features/loyalty/input-modes";

const ESTIMATE_TYPICAL_ORDER_CENTS = 1200;
const ESTIMATE_REGULARS_PER_MONTH = 30;

type RewardDraft = {
  key: string;
  kind: RewardKind;
  name: string;
  value: string;
  costMode: InputMode;
  cost: string;
};

/**
 * Sequential, not random. This key becomes the `id`, `htmlFor`, and
 * `aria-describedby` of every field in a reward row, so a value that differs
 * between the server render and hydration desynchronises them — and React does
 * not repair mismatched attributes, it only warns. The result was labels
 * pointing at inputs that no longer existed, which breaks click-to-focus and
 * leaves screen readers announcing nothing.
 *
 * A counter is deterministic where it matters: the initial draft is created
 * once at module scope on each side, so both arrive at the same first key.
 * Every later reward is added by a click, which only ever happens on the
 * client.
 */
let rewardKeySeq = 0;

function newReward(): RewardDraft {
  return {
    key: `r${rewardKeySeq++}`,
    kind: "FREE_ITEM",
    name: "",
    value: "",
    costMode: "estimate",
    cost: "",
  };
}

type FormState = {
  typicalOrderMode: InputMode;
  typicalOrder: string;
  cadence: VisitCadence;
  goal: LoyaltyGoal;
  rewards: RewardDraft[];
  budgetMode: InputMode;
  budget: string;
  regularsMode: InputMode;
  regulars: string;
  existingSystem: ExistingSystem;
};

const INITIAL_FORM: FormState = {
  typicalOrderMode: "known",
  typicalOrder: "",
  cadence: "weekly",
  goal: "repeat_visits",
  rewards: [newReward()],
  budgetMode: "skip",
  budget: "",
  regularsMode: "estimate",
  regulars: "",
  existingSystem: "none",
};

/** Fingerprint of every answer that changes the arithmetic. */
function fingerprint(f: FormState): string {
  return JSON.stringify([
    f.typicalOrderMode,
    f.typicalOrder.trim(),
    f.cadence,
    f.goal,
    f.rewards.map((r) => [
      r.kind,
      r.name.trim(),
      r.value.trim(),
      r.costMode,
      r.cost.trim(),
    ]),
    f.budgetMode,
    f.budget.trim(),
    f.regularsMode,
    f.regulars.trim(),
    f.existingSystem,
  ]);
}

type Computed = {
  result: AdvisorResult;
  guidance: ExistingSystemGuidance | null;
  fingerprint: string;
};

export function LoyaltyConsultation({
  organizationId,
  hasActiveProgram,
  aiEnabled = false,
}: {
  organizationId: string;
  hasActiveProgram: boolean;
  /** Whether the conversational layer is configured on this deployment. */
  aiEnabled?: boolean;
}) {
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [computed, setComputed] = React.useState<Computed | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string | undefined>
  >({});
  const [status, setStatus] = React.useState<"idle" | "working" | "error">(
    "idle",
  );
  const resultsRef = React.useRef<HTMLDivElement | null>(null);

  const currentFingerprint = fingerprint(form);
  const isStale =
    computed !== null && computed.fingerprint !== currentFingerprint;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setReward(key: string, patch: Partial<RewardDraft>) {
    setForm((prev) => ({
      ...prev,
      rewards: prev.rewards.map((r) =>
        r.key === key ? { ...r, ...patch } : r,
      ),
    }));
  }

  function handleConsult(event: React.FormEvent) {
    event.preventDefault();
    setStatus("working");
    const errors: Record<string, string | undefined> = {};

    const order = resolveMoneyField(
      form.typicalOrderMode,
      form.typicalOrder,
      ESTIMATE_TYPICAL_ORDER_CENTS,
      "Typical order total",
    );
    if (!order.ok) errors.typicalOrder = order.message;

    const budget = resolveMoneyField(
      form.budgetMode,
      form.budget,
      null,
      "Monthly reward budget",
    );
    if (!budget.ok) errors.budget = budget.message;

    const regulars = resolveCountField(
      form.regularsMode,
      form.regulars,
      ESTIMATE_REGULARS_PER_MONTH,
      "Regulars per month",
    );
    if (!regulars.ok) errors.regulars = regulars.message;

    const rewards: RewardSpec[] = [];
    form.rewards.forEach((r, i) => {
      const value = parseMoneyStrict(r.value);
      // Only a free item needs naming; a discount's name is its amount.
      if (r.kind === "FREE_ITEM" && !r.name.trim()) {
        errors[`reward-${r.key}-name`] = `Name reward ${i + 1}.`;
      }
      if (value === "invalid" || value === null) {
        errors[`reward-${r.key}-value`] =
          r.kind === "FREE_ITEM"
            ? "Enter the item's menu price, like 3.50."
            : "Enter the discount amount, like 3.";
        return;
      }
      if (r.kind === "FREE_ITEM") {
        const cost = resolveMoneyField(
          r.costMode,
          r.cost,
          Math.floor((value * 30) / 100),
          "Your cost",
        );
        if (!cost.ok) {
          errors[`reward-${r.key}-cost`] = cost.message;
          return;
        }
        rewards.push({
          kind: "FREE_ITEM",
          name: r.name.trim(),
          retailCents: value,
          unitCostCents: r.costMode === "known" ? cost.cents : null,
        });
      } else {
        rewards.push({
          kind: "FIXED_DISCOUNT",
          // Derived from the amount, so the two can never disagree.
          name: `${formatCents(value)} off`,
          discountCents: value,
        });
      }
    });

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setStatus("error");
      return;
    }

    const answers: ConsultationAnswers = {
      typicalOrderCents: {
        value: order.ok ? order.cents : null,
        source: order.ok ? order.source : "skipped",
      },
      cadence: form.cadence,
      cadenceSource: form.cadence === "unsure" ? "estimated" : "provided",
      goal: form.goal,
      rewards,
      monthlyBudgetCents: {
        value: budget.ok ? budget.cents : null,
        source: budget.ok ? budget.source : "skipped",
      },
      regularsPerMonth: {
        value: regulars.ok ? regulars.count : ESTIMATE_REGULARS_PER_MONTH,
        source: regulars.ok ? regulars.source : "estimated",
      },
      existingSystem: form.existingSystem,
    };

    setComputed({
      result: recommendPrograms(answers),
      guidance: existingSystemGuidance(form.existingSystem),
      fingerprint: fingerprint(form),
    });
    setStatus("idle");
    window.requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      resultsRef.current?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="space-y-6">
      <AdvisorIntro aiEnabled={aiEnabled} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-brand" aria-hidden="true" />
            Tell the advisor about your cart
          </CardTitle>
          <CardDescription>
            Anything you don&apos;t know, say so — the advisor uses a clearly
            labeled estimate rather than pretending.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleConsult} className="space-y-5" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField
                id="typicalOrder"
                label="Typical order total"
                hint="What a regular spends on one visit."
                mode={form.typicalOrderMode}
                onModeChange={(m) => set("typicalOrderMode", m)}
                value={form.typicalOrder}
                onValueChange={(v) => set("typicalOrder", v)}
                error={fieldErrors.typicalOrder}
                estimateNote={`Uses ${formatCents(ESTIMATE_TYPICAL_ORDER_CENTS)} as a starting point.`}
              />

              <div className="space-y-1.5">
                <Label htmlFor="cadence">
                  How often does a regular come back?
                </Label>
                <Select
                  id="cadence"
                  value={form.cadence}
                  onChange={(e) =>
                    set("cadence", e.target.value as VisitCadence)
                  }
                >
                  {(Object.keys(VISIT_CADENCE_LABEL) as VisitCadence[]).map(
                    (c) => (
                      <option key={c} value={c}>
                        {VISIT_CADENCE_LABEL[c]}
                      </option>
                    ),
                  )}
                </Select>
                <p className="text-xs text-muted-foreground">
                  Measured per week; monthly figures convert at 4.33 weeks.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="goal">What are you trying to encourage?</Label>
                <Select
                  id="goal"
                  value={form.goal}
                  onChange={(e) => set("goal", e.target.value as LoyaltyGoal)}
                >
                  <option value="repeat_visits">More repeat visits</option>
                  <option value="bigger_orders">Bigger orders</option>
                  <option value="new_item">Trying a specific item</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="existingSystem">
                  Do you already run a loyalty program?
                </Label>
                <Select
                  id="existingSystem"
                  value={form.existingSystem}
                  onChange={(e) =>
                    set("existingSystem", e.target.value as ExistingSystem)
                  }
                >
                  <option value="none">No, this would be the first</option>
                  <option value="paper">Paper punch cards</option>
                  <option value="square_or_pos">
                    Square / Toast / Clover loyalty
                  </option>
                  <option value="other">Something else</option>
                </Select>
              </div>
            </div>

            <fieldset className="space-y-4 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-medium">
                Rewards customers can spend points on
              </legend>
              <p className="text-xs text-muted-foreground">
                List one to four. The advisor prices each in points from its
                value and your cost — you never pick the point numbers yourself.
              </p>

              {form.rewards.map((r, i) => (
                <div
                  key={r.key}
                  className="space-y-3 rounded-md border border-border/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Reward {i + 1}</p>
                    {form.rewards.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          set(
                            "rewards",
                            form.rewards.filter((x) => x.key !== r.key),
                          )
                        }
                      >
                        <Trash2 aria-hidden="true" />
                        Remove
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`kind-${r.key}`}>Type</Label>
                      <Select
                        id={`kind-${r.key}`}
                        value={r.kind}
                        onChange={(e) =>
                          setReward(r.key, {
                            kind: e.target.value as RewardKind,
                          })
                        }
                      >
                        <option value="FREE_ITEM">A free menu item</option>
                        <option value="FIXED_DISCOUNT">
                          A fixed amount off
                        </option>
                      </Select>
                    </div>
                    {/*
                      A discount needs no name field. "$3 off" is the amount
                      restated, so asking for both invited an owner to type one
                      figure in words and a different one in numbers — and the
                      words were never used. Free items genuinely need a name.
                    */}
                    {r.kind === "FREE_ITEM" ? (
                      <div className="space-y-1.5">
                        <Label htmlFor={`name-${r.key}`}>Which item?</Label>
                        <Input
                          id={`name-${r.key}`}
                          placeholder="Horchata"
                          value={r.name}
                          onChange={(e) =>
                            setReward(r.key, { name: e.target.value })
                          }
                          aria-describedby={`reward-${r.key}-name-error`}
                        />
                        <FieldError
                          id={`reward-${r.key}-name-error`}
                          errors={
                            fieldErrors[`reward-${r.key}-name`]
                              ? [fieldErrors[`reward-${r.key}-name`]!]
                              : undefined
                          }
                        />
                      </div>
                    ) : null}
                    <div className="space-y-1.5">
                      <Label htmlFor={`value-${r.key}`}>
                        {r.kind === "FREE_ITEM"
                          ? "Menu price"
                          : "How much off?"}
                      </Label>
                      <Input
                        id={`value-${r.key}`}
                        inputMode="decimal"
                        placeholder={r.kind === "FREE_ITEM" ? "3.50" : "3"}
                        value={r.value}
                        onChange={(e) =>
                          setReward(r.key, { value: e.target.value })
                        }
                        aria-describedby={`reward-${r.key}-value-error`}
                      />
                      <FieldError
                        id={`reward-${r.key}-value-error`}
                        errors={
                          fieldErrors[`reward-${r.key}-value`]
                            ? [fieldErrors[`reward-${r.key}-value`]!]
                            : undefined
                        }
                      />
                    </div>
                  </div>

                  {r.kind === "FREE_ITEM" ? (
                    <MoneyField
                      id={`cost-${r.key}`}
                      label="What it costs you to make"
                      hint="Ingredients and cup — not the menu price."
                      mode={r.costMode}
                      onModeChange={(m) => setReward(r.key, { costMode: m })}
                      value={r.cost}
                      onValueChange={(v) => setReward(r.key, { cost: v })}
                      error={fieldErrors[`reward-${r.key}-cost`]}
                      estimateNote="Uses 30% of the menu price, clearly labeled as an estimate."
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      A discount costs you its full face value — there&apos;s no
                      cost field because the amount off <em>is</em> the cost.
                    </p>
                  )}
                </div>
              ))}

              {form.rewards.length < 4 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => set("rewards", [...form.rewards, newReward()])}
                >
                  <Plus aria-hidden="true" />
                  Add another reward
                </Button>
              ) : null}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField
                id="budget"
                label="Monthly reward budget"
                hint="Across all your customers put together — not per person. The total you could hand out in food or discounts in a month."
                mode={form.budgetMode}
                onModeChange={(m) => set("budgetMode", m)}
                value={form.budget}
                onValueChange={(v) => set("budget", v)}
                error={fieldErrors.budget}
                estimateNote="Skipping means budget fit is not checked."
                allowEstimate={false}
              />
              <CountField
                id="regulars"
                label="Regular customers per month"
                hint="Roughly how many different repeat customers you see."
                mode={form.regularsMode}
                onModeChange={(m) => set("regularsMode", m)}
                value={form.regulars}
                onValueChange={(v) => set("regulars", v)}
                error={fieldErrors.regulars}
                estimateNote={`Uses ${ESTIMATE_REGULARS_PER_MONTH} regulars/month as a starting point.`}
              />
            </div>

            {status === "error" ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertDescription>
                  Some answers need fixing before the advisor can calculate.
                </AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" disabled={status === "working"}>
              {status === "working" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : isStale ? (
                <RefreshCw aria-hidden="true" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              {status === "working"
                ? "Calculating…"
                : isStale
                  ? "Recalculate with these answers"
                  : "Get recommendations"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {computed ? (
        <div
          ref={resultsRef}
          tabIndex={-1}
          className="space-y-4 outline-none"
          aria-live="polite"
        >
          {isStale ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>
                <strong>These results are out of date.</strong> You changed your
                answers after this was calculated, so the numbers below no
                longer match the form. Select{" "}
                <em>Recalculate with these answers</em> to refresh. Publishing
                is disabled until you do.
              </AlertDescription>
            </Alert>
          ) : null}

          <InputSummary
            summary={computed.result.inputSummary}
            stale={isStale}
          />

          {computed.guidance ? (
            <ExistingSystemCard guidance={computed.guidance} />
          ) : null}

          <div>
            <h2 className="text-lg font-semibold">
              {computed.result.recommendations.length > 0
                ? "Recommended programs"
                : "No safe program from these answers"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Every option earns {computed.result.pointsPerDollar} points per $1
              of verified spend. They differ in the reward catalog.
            </p>
          </div>

          {computed.result.recommendations.length === 0 ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>
                None of your rewards could be priced safely. The exclusions
                below explain exactly why and what would change that.
              </AlertDescription>
            </Alert>
          ) : (
            computed.result.recommendations.map((rec, index) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                organizationId={organizationId}
                highlighted={index === 0}
                replacing={hasActiveProgram}
                stale={isStale}
                inputsFingerprint={computed.fingerprint}
                currentFingerprint={currentFingerprint}
              />
            ))
          )}

          {computed.result.excluded.length > 0 ? (
            <ExcludedList excluded={computed.result.excluded} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Framing shown above the questions.
 *
 * Kept deliberately short: an owner opening this between orders needs to know
 * what they are about to do and that nothing changes without them. The full
 * economics live next to the numbers themselves, where they can be checked
 * against something.
 */
function AdvisorIntro({ aiEnabled }: { aiEnabled: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <Sparkles className="size-5 text-brand" aria-hidden="true" />
          Reward recommender
          {aiEnabled ? (
            <span className="rounded-full bg-secondary/20 px-2 py-0.5 text-xs font-medium text-brand">
              with {ADVISOR_MODEL_LABEL}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          Answer a few questions and it prices your rewards in points, then
          shows what each one costs you. Nothing changes until you press
          publish.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/*
          Numbered by the browser, not by hand. Hand-written "1." markers put a
          significant space between an element and a text node, and JSX drops
          that space depending on where the formatter happens to wrap the line
          — which silently produced "1.You name" while its siblings were fine.
        */}
        <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground marker:font-medium marker:text-foreground">
          <li>
            You name the rewards you&apos;d hand over — a drink, a taco, money
            off.
          </li>
          <li>
            It works out how many points each should cost, and how much a
            customer has to spend to get there.
          </li>
          <li>
            You pick one and publish. What you published before keeps running
            until you do.
          </li>
        </ol>

        {/*
          Stated precisely rather than flatteringly: the pricing is arithmetic,
          not a model's opinion. An owner trusting these numbers with their
          margins deserves to know which part is which.
        */}
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">
            The numbers are calculated, not guessed.
          </strong>{" "}
          Every points price and cost figure comes from server-side arithmetic
          using only what you typed above.{" "}
          {aiEnabled ? (
            <>
              {ADVISOR_MODEL_LABEL} is available to explain the tradeoffs in
              plain language, but it cannot publish, change, or pay out
              anything.
            </>
          ) : (
            <>
              Plain-language AI explanations are switched off on this
              installation; the recommendations below work either way.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Three separately-labelled boxes, deliberately not merged.
 *
 * An owner comparing their cart to McDonald's needs to know which number is
 * whose. Blending "what a chain does", "what CurbAgora suggests", and "what
 * yours actually costs" into one figure is how a vendor ends up believing a
 * benchmark is a target, or that a suggestion is a measurement of their own
 * business.
 */
function ReturnComparison({
  economics,
}: {
  economics: LoyaltyRecommendation["economics"];
}) {
  const entry = economics.entry;
  const band = bandFor(DEFAULT_STANCE);
  const isDiscount = entry.reward.kind === "FIXED_DISCOUNT";

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-border p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          What chains do
        </p>
        <ul className="mt-1.5 space-y-1 text-xs">
          {CHAIN_BENCHMARKS.map((b) => (
            <li key={b.company} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{b.company}</span>
              <span className="font-medium tabular-nums">
                {formatBps(b.returnBps)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Published cash-reward programs, read {CHAIN_BENCHMARKS[0].reviewed}.
          They change these without notice.
        </p>
      </div>

      <div className="rounded-lg border border-secondary/50 bg-accent/30 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-brand">
          What CurbAgora suggests
        </p>
        <p className="mt-1.5 text-lg font-semibold tabular-nums">
          {formatBps(band.lowBps)}–{formatBps(band.highBps)}
        </p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {band.label} — {band.bestFor}. A starting range from the programs on
          the left, not a guarantee.
        </p>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          What yours does
        </p>
        <p className="mt-1.5 text-lg font-semibold tabular-nums">
          {formatBps(entry.perceivedRateBps)}
        </p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {placeAgainstChains(entry.perceivedRateBps)}{" "}
          {isDiscount ? (
            <>Costs you the same {formatBps(entry.costRateBps)}.</>
          ) : (
            <>
              Costs you {formatBps(entry.costRateBps)}
              {entry.reward.costSource === "estimated" ? " (estimated)" : ""}.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function ModeSelect({
  id,
  label,
  mode,
  onModeChange,
  allowEstimate,
}: {
  id: string;
  label: string;
  mode: InputMode;
  onModeChange: (m: InputMode) => void;
  allowEstimate: boolean;
}) {
  return (
    <Select
      id={`${id}-mode`}
      aria-label={`${label} — how would you like to answer?`}
      // py-0 alongside h-8: the base style pairs h-10 with py-2, and shrinking
      // only the height left a 14px content box for a 16px line, which clipped
      // the label. A native select centres its own text, so drop the padding.
      className="h-8 py-0 text-xs"
      value={mode}
      onChange={(e) => onModeChange(e.target.value as InputMode)}
    >
      <option value="known">{INPUT_MODE_LABEL.known}</option>
      {allowEstimate ? (
        <option value="estimate">{INPUT_MODE_LABEL.estimate}</option>
      ) : null}
      <option value="skip">{INPUT_MODE_LABEL.skip}</option>
    </Select>
  );
}

function MoneyField({
  id,
  label,
  hint,
  mode,
  onModeChange,
  value,
  onValueChange,
  error,
  estimateNote,
  allowEstimate = true,
}: {
  id: string;
  label: string;
  hint: string;
  mode: InputMode;
  onModeChange: (m: InputMode) => void;
  value: string;
  onValueChange: (v: string) => void;
  error?: string;
  estimateNote: string;
  allowEstimate?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <ModeSelect
        id={id}
        label={label}
        mode={mode}
        onModeChange={onModeChange}
        allowEstimate={allowEstimate}
      />
      {mode === "known" ? (
        <Input
          id={id}
          inputMode="decimal"
          placeholder="12.50"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          aria-describedby={`${id}-error`}
        />
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {mode === "estimate" ? estimateNote : `Skipped. ${estimateNote}`}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{hint}</p>
      <FieldError id={`${id}-error`} errors={error ? [error] : undefined} />
    </div>
  );
}

function CountField(props: {
  id: string;
  label: string;
  hint: string;
  mode: InputMode;
  onModeChange: (m: InputMode) => void;
  value: string;
  onValueChange: (v: string) => void;
  error?: string;
  estimateNote: string;
}) {
  const { id, label, hint, mode, onModeChange, value, onValueChange, error } =
    props;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <ModeSelect
        id={id}
        label={label}
        mode={mode}
        onModeChange={onModeChange}
        allowEstimate
      />
      {mode === "known" ? (
        <Input
          id={id}
          inputMode="numeric"
          placeholder="30"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          aria-describedby={`${id}-error`}
        />
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {props.estimateNote}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{hint}</p>
      <FieldError id={`${id}-error`} errors={error ? [error] : undefined} />
    </div>
  );
}

function InputSummary({
  summary,
  stale,
}: {
  summary: AdvisorResult["inputSummary"];
  stale: boolean;
}) {
  return (
    <Card className={stale ? "opacity-60" : undefined}>
      <CardHeader>
        <CardTitle className="text-base">
          What these numbers were calculated from
        </CardTitle>
        <CardDescription>
          Every figure below, and where it came from.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {summary.map((row) => (
            <div key={row.label} className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{row.label}:</dt>
              <dd>
                {row.value}{" "}
                <span className="text-xs text-muted-foreground">
                  ({row.source})
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function ExistingSystemCard({
  guidance,
}: {
  guidance: ExistingSystemGuidance;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{guidance.title}</CardTitle>
        <CardDescription>{guidance.summary}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {guidance.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function ExcludedList({ excluded }: { excluded: AdvisorResult["excluded"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Why some options were excluded
        </CardTitle>
        <CardDescription>
          Rewards and catalogs the advisor considered and did not recommend,
          with the arithmetic behind each decision.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {excluded.map((e, i) => (
          <div
            key={`${e.label}-${i}`}
            className="border-l-2 border-border pl-3"
          >
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {e.label}
              <span
                className={
                  e.severity === "block"
                    ? "rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive"
                    : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                }
              >
                {e.severity === "block"
                  ? "Blocked by platform limit"
                  : "Ranked lower"}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">{e.reason}</p>
            {e.calculation ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {e.calculation}
              </p>
            ) : null}
            {e.remedy ? (
              <p className="mt-1 text-xs">
                <span className="font-medium">What would fix it: </span>
                {e.remedy}
              </p>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RecommendationCard({
  rec,
  organizationId,
  highlighted,
  replacing,
  stale,
  inputsFingerprint,
  currentFingerprint,
}: {
  rec: LoyaltyRecommendation;
  organizationId: string;
  highlighted: boolean;
  replacing: boolean;
  stale: boolean;
  inputsFingerprint: string;
  currentFingerprint: string;
}) {
  const [state, formAction] = useActionState(
    publishLoyaltyProgramAction,
    idleState,
  );
  const e = rec.economics;

  return (
    <Card
      className={
        stale ? "opacity-60" : highlighted ? "border-secondary" : undefined
      }
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">{rec.title}</CardTitle>
          {highlighted && !stale ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              Best fit
            </span>
          ) : null}
        </div>
        <CardDescription>{rec.earnRule}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reward menu
          </p>
          <ul className="mt-1 space-y-1 text-sm">
            {rec.tiers.map((t) => (
              <li key={t.pointsCost} className="flex gap-2">
                <span className="rounded-full bg-secondary/20 px-2 py-0.5 text-xs font-medium text-brand">
                  {formatPoints(t.pointsCost)}
                </span>
                <span>{t.summary}</span>
              </li>
            ))}
          </ul>
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-4 text-sm sm:grid-cols-4">
          <Stat
            label="Spend to first reward"
            value={formatCents(e.entry.spendToEarnCents)}
          />
          <Stat
            label="Customer value"
            value={formatBps(e.entry.perceivedRateBps)}
          />
          <Stat
            label={
              e.entry.reward.costSource === "estimated"
                ? "Est. your cost"
                : "Your cost"
            }
            value={formatBps(e.entry.costRateBps)}
          />
          <Stat
            label="Est. monthly cost"
            value={`${formatCents(e.monthlyCostLowCents)}–${formatCents(e.monthlyCostHighCents)}`}
          />
        </dl>

        <ReturnComparison economics={e} />

        {rec.why.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Why this fits
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {rec.why.map((line, i) => (
                <li key={i} className="flex gap-2">
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {rec.warnings.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Watch for
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {rec.warnings.map((w, i) => (
                <li key={`${w.code}-${i}`} className="flex gap-2">
                  <TriangleAlert
                    className="mt-0.5 size-4 shrink-0 text-live"
                    aria-hidden="true"
                  />
                  <span>
                    {w.message}
                    {w.calculation ? (
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                        {w.calculation}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Assumptions, scoring, refunds &amp; pause
          </summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {rec.assumptions.map((line, i) => (
              <li key={i}>• {line}</li>
            ))}
            <li>• {rec.refundNote}</li>
            <li>• {rec.pauseNote}</li>
          </ul>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            How this scored {rec.fitScore}
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
            {rec.scoreBreakdown.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>

        {state.status === "error" && state.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === "success" && state.message ? (
          <Alert>
            <CheckCircle2 aria-hidden="true" />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        <form action={formAction}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input
            type="hidden"
            name="pointsPerDollar"
            value={rec.config.pointsPerDollar}
          />
          <input
            type="hidden"
            name="catalog"
            value={JSON.stringify(
              rec.config.catalog.map((c) => ({
                pointsCost: c.pointsCost,
                rewardKind: c.reward.kind,
                rewardName: c.reward.name,
                rewardValueCents:
                  c.reward.kind === "FREE_ITEM"
                    ? c.reward.retailCents
                    : c.reward.discountCents,
                rewardEstCostCents:
                  c.reward.kind === "FREE_ITEM" ? c.reward.unitCostCents : null,
              })),
            )}
          />
          <input
            type="hidden"
            name="inputsFingerprint"
            value={inputsFingerprint}
          />
          <input
            type="hidden"
            name="currentFingerprint"
            value={currentFingerprint}
          />
          <input
            type="hidden"
            name="advisorSnapshot"
            value={JSON.stringify({
              recommendationId: rec.id,
              shape: rec.shape,
              fitScore: rec.fitScore,
              scoreBreakdown: rec.scoreBreakdown,
              entry: {
                pointsCost: e.entry.pointsCost,
                spendToEarnCents: e.entry.spendToEarnCents,
                perceivedRateBps: e.entry.perceivedRateBps,
                costRateBps: e.entry.costRateBps,
              },
            })}
          />
          {stale ? (
            <p className="text-sm text-muted-foreground">
              Recalculate before publishing this option.
            </p>
          ) : (
            <SubmitButton
              variant={highlighted ? "default" : "outline"}
              pendingLabel="Publishing…"
            >
              {replacing
                ? "Replace live program with this"
                : "Approve & publish"}
            </SubmitButton>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
