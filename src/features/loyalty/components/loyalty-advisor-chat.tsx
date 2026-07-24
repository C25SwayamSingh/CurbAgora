"use client";

import * as React from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { askLoyaltyAdvisorAction } from "@/features/loyalty/actions";

const SUGGESTIONS = [
  "Is my reward too hard to reach?",
  "Is this costing me too much?",
  "What could I try for slow afternoons?",
];

/**
 * Optional conversational advisor. Rendered only when the deployment has an
 * ANTHROPIC_API_KEY (the parent page checks `isLoyaltyConsultantConfigured`).
 * The model can only explain — every balance and program change stays with the
 * deterministic engine and the owner's own controls.
 */
export function LoyaltyAdvisorChat() {
  const [question, setQuestion] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [answer, setAnswer] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || pending) return;
    setError(null);
    setAnswer(null);
    setPending(true);
    try {
      const result = await askLoyaltyAdvisorAction(trimmed);
      if (result.ok) {
        setAnswer(result.text);
      } else {
        setError(result.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageCircle className="size-5 text-brand" aria-hidden="true" />
          Ask the advisor
        </CardTitle>
        <CardDescription>
          Ask about your program in plain language. The advisor explains — it
          never changes anything. You stay in control of every rule.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <Button
              key={s}
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setQuestion(s);
                void ask(s);
              }}
            >
              {s}
            </Button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
          className="space-y-2"
        >
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Is my first reward too far away?"
            rows={2}
          />
          <Button type="submit" disabled={pending || !question.trim()}>
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Send aria-hidden="true" />
            )}
            Ask
          </Button>
        </form>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {answer ? (
          <div className="rounded-lg border border-border bg-muted/60 p-4 text-sm whitespace-pre-wrap">
            {answer}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
