"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Sparkles,
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
import { SubmitButton } from "@/features/authentication/components/submit-button";
import { publishLoyaltyProgramAction } from "@/features/loyalty/actions";
import {
  existingSystemAdvice,
  recommendPrograms,
  type ConsultationAnswers,
  type ExistingSystem,
  type LoyaltyGoal,
  type LoyaltyRecommendation,
  type VisitFrequency,
} from "@/features/loyalty/advisor";
import { formatBps, formatCents } from "@/features/loyalty/engine";

/** Parse a "$12.50" / "12.50" / "" dollar input into integer cents or null. */
function dollarsToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function intOrNull(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9]/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

type FormState = {
  typicalOrder: string;
  visitFrequency: VisitFrequency;
  goal: LoyaltyGoal;
  rewardName: string;
  rewardRetail: string;
  rewardCost: string;
  monthlyBudget: string;
  regulars: string;
  existingSystem: ExistingSystem;
};

const INITIAL_FORM: FormState = {
  typicalOrder: "",
  visitFrequency: "weekly",
  goal: "repeat_visits",
  rewardName: "",
  rewardRetail: "",
  rewardCost: "",
  monthlyBudget: "",
  regulars: "",
  existingSystem: "none",
};

export function LoyaltyConsultation({
  organizationId,
  hasActiveProgram,
}: {
  organizationId: string;
  hasActiveProgram: boolean;
}) {
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [recommendations, setRecommendations] = React.useState<
    LoyaltyRecommendation[] | null
  >(null);
  const [systemNote, setSystemNote] = React.useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleConsult(event: React.FormEvent) {
    event.preventDefault();
    const answers: ConsultationAnswers = {
      typicalOrderCents: dollarsToCents(form.typicalOrder),
      visitFrequency: form.visitFrequency,
      goal: form.goal,
      rewards: form.rewardName.trim()
        ? [
            {
              name: form.rewardName.trim(),
              retailCents: dollarsToCents(form.rewardRetail) ?? 300,
              costCents: dollarsToCents(form.rewardCost),
            },
          ]
        : [],
      monthlyBudgetCents: dollarsToCents(form.monthlyBudget),
      estimatedMonthlyRegulars: intOrNull(form.regulars),
      existingSystem: form.existingSystem,
    };
    setRecommendations(recommendPrograms(answers));
    setSystemNote(existingSystemAdvice(form.existingSystem));
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-brand" aria-hidden="true" />
            Loyalty Advisor
          </CardTitle>
          <CardDescription>
            Answer a few questions about your cart. The advisor models the
            economics and suggests a program that fits your margins — you review
            and approve the exact rules before anything goes live. Every number
            below is calculated, not guessed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleConsult} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="typicalOrder">Typical order total</Label>
                <Input
                  id="typicalOrder"
                  inputMode="decimal"
                  placeholder="$12 (or leave blank)"
                  value={form.typicalOrder}
                  onChange={(e) => set("typicalOrder", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Roughly what a regular spends per visit. Skip if unsure.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="visitFrequency">
                  How often do regulars return?
                </Label>
                <Select
                  id="visitFrequency"
                  value={form.visitFrequency}
                  onChange={(e) =>
                    set("visitFrequency", e.target.value as VisitFrequency)
                  }
                >
                  <option value="weekly">About weekly</option>
                  <option value="biweekly">Every couple of weeks</option>
                  <option value="monthly">About monthly</option>
                  <option value="unsure">Not sure</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="goal">
                  What do you most want to encourage?
                </Label>
                <Select
                  id="goal"
                  value={form.goal}
                  onChange={(e) => set("goal", e.target.value as LoyaltyGoal)}
                >
                  <option value="repeat_visits">More repeat visits</option>
                  <option value="slow_hours">Visits during slow hours</option>
                  <option value="new_item">Trying a specific item</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="existingSystem">Current loyalty setup?</Label>
                <Select
                  id="existingSystem"
                  value={form.existingSystem}
                  onChange={(e) =>
                    set("existingSystem", e.target.value as ExistingSystem)
                  }
                >
                  <option value="none">None yet</option>
                  <option value="paper">Paper punch cards</option>
                  <option value="square_or_pos">
                    Square / Toast / POS loyalty
                  </option>
                  <option value="other">Something else</option>
                </Select>
              </div>
            </div>

            <fieldset className="space-y-4 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-medium">
                The reward customers work toward
              </legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rewardName">Reward item</Label>
                  <Input
                    id="rewardName"
                    placeholder="Free drink"
                    value={form.rewardName}
                    onChange={(e) => set("rewardName", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rewardRetail">Menu price</Label>
                  <Input
                    id="rewardRetail"
                    inputMode="decimal"
                    placeholder="$3"
                    value={form.rewardRetail}
                    onChange={(e) => set("rewardRetail", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rewardCost">Your cost (optional)</Label>
                  <Input
                    id="rewardCost"
                    inputMode="decimal"
                    placeholder="Help me estimate"
                    value={form.rewardCost}
                    onChange={(e) => set("rewardCost", e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Leave your cost blank and the advisor estimates 30% of the menu
                price — clearly labeled as an estimate until you enter the real
                figure.
              </p>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="monthlyBudget">
                  Monthly reward budget (optional)
                </Label>
                <Input
                  id="monthlyBudget"
                  inputMode="decimal"
                  placeholder="$150"
                  value={form.monthlyBudget}
                  onChange={(e) => set("monthlyBudget", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="regulars">
                  Active regulars per month (optional)
                </Label>
                <Input
                  id="regulars"
                  inputMode="numeric"
                  placeholder="30"
                  value={form.regulars}
                  onChange={(e) => set("regulars", e.target.value)}
                />
              </div>
            </div>

            <Button type="submit">
              <Sparkles aria-hidden="true" />
              Get recommendations
            </Button>
          </form>
        </CardContent>
      </Card>

      {systemNote ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertDescription>{systemNote}</AlertDescription>
        </Alert>
      ) : null}

      {recommendations ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">
              {recommendations.length > 0
                ? "Recommended programs"
                : "No recommendation yet"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Ranked by fit for what you told us. Review the economics, then
              approve one to publish. You can always adjust and re-run this.
            </p>
          </div>
          {recommendations.length === 0 ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>
                Those inputs didn&apos;t produce a safe program — the reward may
                cost too much relative to the qualifying spend. Try a lower-cost
                reward or a higher typical order.
              </AlertDescription>
            </Alert>
          ) : (
            recommendations.map((rec, index) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                organizationId={organizationId}
                highlighted={index === 0}
                replacing={hasActiveProgram}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function RecommendationCard({
  rec,
  organizationId,
  highlighted,
  replacing,
}: {
  rec: LoyaltyRecommendation;
  organizationId: string;
  highlighted: boolean;
  replacing: boolean;
}) {
  const [state, formAction] = useActionState(
    publishLoyaltyProgramAction,
    idleState,
  );
  const e = rec.economics;

  return (
    <Card className={highlighted ? "border-secondary" : undefined}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">{rec.title}</CardTitle>
          {highlighted ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              Best fit
            </span>
          ) : null}
        </div>
        <CardDescription>{rec.rewardRule}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{rec.earnRule}</p>

        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-4 text-sm sm:grid-cols-4">
          <Stat
            label="Visits to first reward"
            value={String(e.visitsToFirstReward)}
          />
          <Stat label="Customer value" value={formatBps(e.perceivedRateBps)} />
          <Stat
            label={e.costIsEstimated ? "Est. your cost" : "Your cost"}
            value={formatBps(e.costRateBps)}
          />
          <Stat
            label="Est. monthly cost"
            value={`${formatCents(e.monthlyCostLowCents)}–${formatCents(e.monthlyCostHighCents)}`}
          />
        </dl>

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

        {rec.risks.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Watch for
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {rec.risks.map((line, i) => (
                <li key={i} className="flex gap-2">
                  <TriangleAlert
                    className="mt-0.5 size-4 shrink-0 text-live"
                    aria-hidden="true"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Assumptions &amp; what happens on refunds / pause
          </summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {rec.assumptions.map((line, i) => (
              <li key={i}>• {line}</li>
            ))}
            <li>• {rec.refundNote}</li>
            <li>• {rec.pauseNote}</li>
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
            name="stampsRequired"
            value={rec.config.stampsRequired}
          />
          <input
            type="hidden"
            name="qualifyingMinCents"
            value={rec.config.qualifyingMinCents}
          />
          <input
            type="hidden"
            name="stampPeriodMinutes"
            value={rec.config.stampPeriodMinutes}
          />
          <input
            type="hidden"
            name="rewardName"
            value={rec.config.rewardName}
          />
          <input
            type="hidden"
            name="rewardRetailValueCents"
            value={rec.config.rewardRetailValueCents}
          />
          <input
            type="hidden"
            name="rewardEstCostCents"
            value={rec.config.rewardEstCostCents ?? ""}
          />
          <input
            type="hidden"
            name="advisorSnapshot"
            value={JSON.stringify({
              recommendationId: rec.id,
              fitScore: rec.fitScore,
              economics: rec.economics,
            })}
          />
          <SubmitButton
            variant={highlighted ? "default" : "outline"}
            pendingLabel="Publishing…"
          >
            {replacing ? "Replace live program with this" : "Approve & publish"}
          </SubmitButton>
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
