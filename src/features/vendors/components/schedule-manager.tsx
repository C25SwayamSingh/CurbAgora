"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  AlertCircle,
  CalendarPlus,
  CheckCircle2,
  Clock,
  MapPin,
  Plus,
  X,
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
import { idleState } from "@/features/authentication/action-state";
import {
  RecurringLocationForm,
  type RecurringDraft,
} from "@/features/vendors/components/recurring-location-form";
import { ScheduledAppearanceForm } from "@/features/vendors/components/scheduled-appearance-form";
import {
  cancelScheduledAppearanceAction,
  confirmRecurringLocationAction,
  setRecurringLocationActiveAction,
} from "@/features/vendors/schedule-actions";
import {
  daysPhrase,
  formatTimeOfDay,
} from "@/features/vendors/schedule-schemas";

export type RecurringRow = RecurringDraft & {
  isActive: boolean;
  lastConfirmedAt: string;
  isCurrent: boolean;
};

export type ScheduledRow = {
  id: string;
  publicLabel: string;
  eventName: string | null;
  startsAt: string;
  endsAt: string;
};

/** Days until a confirmation goes stale, mirroring the SQL threshold. */
const STALE_AFTER_DAYS = 60;
const NUDGE_WITHIN_DAYS = 7;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * The vendor's view of everything CurbAgora believes about where they are.
 *
 * Deliberately shows each entry as the sentence a customer reads, so the
 * vendor is checking the claim itself rather than a form's worth of fields
 * they have to mentally render.
 */
export function ScheduleManager({
  unitId,
  unitName,
  recurring,
  scheduled,
}: {
  unitId: string;
  unitName: string;
  recurring: RecurringRow[];
  scheduled: ScheduledRow[];
}) {
  const [addingRecurring, setAddingRecurring] = React.useState(
    recurring.length === 0,
  );
  const [addingScheduled, setAddingScheduled] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MapPin className="size-5 text-brand" aria-hidden="true" />
            Usual locations
          </h2>
          <p className="text-sm text-muted-foreground">
            Where {unitName} normally parks. Customers see these as “Usually
            here” — never as live.
          </p>
        </div>

        {recurring.map((row) =>
          editingId === row.id ? (
            <Card key={row.id}>
              <CardHeader>
                <CardTitle className="text-base">Edit this spot</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <RecurringLocationForm
                  unitId={unitId}
                  existing={row}
                  onDone={() => setEditingId(null)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </Button>
              </CardContent>
            </Card>
          ) : (
            <RecurringRowCard
              key={row.id}
              unitId={unitId}
              row={row}
              onEdit={() => setEditingId(row.id)}
            />
          ),
        )}

        {addingRecurring ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add a usual location</CardTitle>
              <CardDescription>
                Somewhere you park on a regular schedule.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <RecurringLocationForm
                unitId={unitId}
                onDone={() => setAddingRecurring(false)}
              />
              {recurring.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddingRecurring(false)}
                >
                  Cancel
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Button variant="outline" onClick={() => setAddingRecurring(true)}>
            <Plus aria-hidden="true" />
            Add a usual location
          </Button>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarPlus className="size-5 text-brand" aria-hidden="true" />
            Scheduled appearances
          </h2>
          <p className="text-sm text-muted-foreground">
            One-off dates — markets, festivals, private bookings.
          </p>
        </div>

        {scheduled.length > 0 ? (
          <ul className="space-y-2">
            {scheduled.map((row) => (
              <ScheduledRowCard key={row.id} unitId={unitId} row={row} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing scheduled yet.
          </p>
        )}

        {addingScheduled ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Add scheduled appearance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ScheduledAppearanceForm
                unitId={unitId}
                onDone={() => setAddingScheduled(false)}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAddingScheduled(false)}
              >
                Cancel
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Button variant="outline" onClick={() => setAddingScheduled(true)}>
            <Plus aria-hidden="true" />
            Add scheduled appearance
          </Button>
        )}
      </section>
    </div>
  );
}

function RecurringRowCard({
  unitId,
  row,
  onEdit,
}: {
  unitId: string;
  row: RecurringRow;
  onEdit: () => void;
}) {
  const [confirmState, confirmAction] = useActionState(
    confirmRecurringLocationAction,
    idleState,
  );
  const [activeState, activeAction] = useActionState(
    setRecurringLocationActiveAction,
    idleState,
  );

  const age = daysSince(row.lastConfirmedAt);
  const daysLeft = STALE_AFTER_DAYS - age;
  const needsNudge = row.isActive && daysLeft <= NUDGE_WITHIN_DAYS;

  return (
    <Card className={row.isActive ? undefined : "opacity-70"}>
      <CardContent className="space-y-3 pt-6">
        <div>
          <p className="font-medium">{row.publicLabel}</p>
          {/* The customer's exact sentence, so there is nothing to translate. */}
          <p className="text-sm text-muted-foreground">
            Usually here {daysPhrase(row.daysOfWeek)},{" "}
            {formatTimeOfDay(row.startTime)}–{formatTimeOfDay(row.endTime)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" aria-hidden="true" />
            {age === 0
              ? "Confirmed today"
              : `Confirmed ${age} day${age === 1 ? "" : "s"} ago`}
            {!row.isActive ? " · turned off" : null}
          </p>
        </div>

        {row.isActive && !row.isCurrent ? (
          <Alert>
            <AlertCircle aria-hidden="true" />
            <AlertDescription>
              Customers aren&apos;t seeing this — it hasn&apos;t been confirmed
              in {STALE_AFTER_DAYS} days. Confirm it to bring it back.
            </AlertDescription>
          </Alert>
        ) : needsNudge ? (
          <Alert>
            <AlertCircle aria-hidden="true" />
            <AlertDescription>
              Still accurate? Confirm within {daysLeft} day
              {daysLeft === 1 ? "" : "s"} to keep it showing.
            </AlertDescription>
          </Alert>
        ) : null}

        {confirmState.status === "success" && confirmState.message ? (
          <Alert variant="success">
            <CheckCircle2 aria-hidden="true" />
            <AlertDescription>{confirmState.message}</AlertDescription>
          </Alert>
        ) : null}
        {activeState.status === "error" && activeState.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{activeState.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <form action={confirmAction}>
            <input type="hidden" name="locationId" value={row.id} />
            <input type="hidden" name="unitId" value={unitId} />
            <Button type="submit" size="sm">
              <CheckCircle2 aria-hidden="true" />
              Still accurate
            </Button>
          </form>
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <form action={activeAction}>
            <input type="hidden" name="locationId" value={row.id} />
            <input type="hidden" name="unitId" value={unitId} />
            <input
              type="hidden"
              name="isActive"
              value={String(!row.isActive)}
            />
            <Button type="submit" variant="ghost" size="sm">
              {row.isActive ? "Turn off" : "Turn back on"}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

function ScheduledRowCard({
  unitId,
  row,
}: {
  unitId: string;
  row: ScheduledRow;
}) {
  const [state, action] = useActionState(
    cancelScheduledAppearanceAction,
    idleState,
  );

  const starts = new Date(row.startsAt);
  const ends = new Date(row.endsAt);
  const dateText = starts.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const timeText = `${starts.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}–${ends.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;

  return (
    <li className="rounded-lg border border-border p-3">
      <p className="font-medium">{row.publicLabel}</p>
      {row.eventName ? (
        <p className="text-sm text-muted-foreground">{row.eventName}</p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {dateText}, {timeText}
      </p>
      {state.status === "error" && state.message ? (
        <p className="mt-1 text-xs text-destructive">{state.message}</p>
      ) : null}
      <form action={action} className="mt-2">
        <input type="hidden" name="occurrenceId" value={row.id} />
        <input type="hidden" name="unitId" value={unitId} />
        <Button type="submit" variant="ghost" size="sm">
          <X aria-hidden="true" />
          Cancel this
        </Button>
      </form>
    </li>
  );
}
