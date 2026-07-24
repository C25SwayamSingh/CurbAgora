"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2, LocateFixed, Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { SubmitButton } from "@/features/authentication/components/submit-button";
import {
  createRecurringLocationAction,
  updateRecurringLocationAction,
} from "@/features/vendors/schedule-actions";
import {
  DAYS_OF_WEEK,
  WEEKDAYS,
  WEEKEND,
  daysPhrase,
  formatTimeOfDay,
} from "@/features/vendors/schedule-schemas";

export type RecurringDraft = {
  id: string;
  publicLabel: string;
  latitude: number;
  longitude: number;
  timezone: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
};

/**
 * "Where are you usually located?"
 *
 * The vendor answers in their own terms — a place, some days, some hours — and
 * never sees a coordinate pair, a verification enum, or the word "provenance".
 * Those are decided server-side from who wrote the row, which is the only
 * signal worth trusting.
 */
export function RecurringLocationForm({
  unitId,
  existing,
  onDone,
}: {
  unitId: string;
  existing?: RecurringDraft;
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState(
    existing ? updateRecurringLocationAction : createRecurringLocationAction,
    idleState,
  );

  const [days, setDays] = React.useState<number[]>(
    existing?.daysOfWeek ?? WEEKDAYS,
  );
  const [start, setStart] = React.useState(existing?.startTime ?? "11:00");
  const [end, setEnd] = React.useState(existing?.endTime ?? "15:00");
  const [coords, setCoords] = React.useState<{
    lat: number;
    lng: number;
  } | null>(
    existing ? { lat: existing.latitude, lng: existing.longitude } : null,
  );
  const [locating, setLocating] = React.useState(false);
  const [geoError, setGeoError] = React.useState<string | null>(null);

  // The browser knows the vendor's zone; asking them to pick one from a list of
  // 1,196 would be a worse question than not asking at all.
  const [timezone] = React.useState(
    () =>
      existing?.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "UTC",
  );

  React.useEffect(() => {
    if (state.status === "success") onDone?.();
  }, [state.status, onDone]);

  function toggleDay(value: number) {
    setDays((prev) =>
      prev.includes(value)
        ? prev.filter((d) => d !== value)
        : [...prev, value].sort((a, b) => a - b),
    );
  }

  function useCurrentSpot() {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("This browser can't share a location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocating(false);
      },
      () => {
        setGeoError(
          "Couldn't get your location. Allow location access, or stand at the spot and try again.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="unitId" value={unitId} />
      {existing ? (
        <input type="hidden" name="locationId" value={existing.id} />
      ) : null}
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="latitude" value={coords?.lat ?? ""} />
      <input type="hidden" name="longitude" value={coords?.lng ?? ""} />
      {days.map((d) => (
        <input key={d} type="hidden" name="daysOfWeek" value={d} />
      ))}

      <div className="space-y-1.5">
        <Label htmlFor="recurring-label">Where are you usually located?</Label>
        <Input
          id="recurring-label"
          name="publicLabel"
          placeholder="Corner of 5th & Main"
          defaultValue={existing?.publicLabel ?? ""}
          maxLength={140}
          aria-describedby="recurring-label-error"
        />
        <p className="text-xs text-muted-foreground">
          However your regulars would describe the spot.
        </p>
        <FieldError
          id="recurring-label-error"
          errors={state.fieldErrors?.publicLabel}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recurring-coords">Pin the spot</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            id="recurring-coords"
            type="button"
            variant="outline"
            size="sm"
            onClick={useCurrentSpot}
            disabled={locating}
          >
            {locating ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed aria-hidden="true" />
            )}
            {coords ? "Update to where I am now" : "Use my current spot"}
          </Button>
          {coords ? (
            <span className="text-xs text-success">
              Pinned ({coords.lat.toFixed(4)}, {coords.lng.toFixed(4)})
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Stand at the spot and tap this.
            </span>
          )}
        </div>
        {geoError ? (
          <p className="text-xs text-destructive">{geoError}</p>
        ) : null}
        <FieldError
          id="recurring-coords-error"
          errors={state.fieldErrors?.latitude}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Which days are you usually here?
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {DAYS_OF_WEEK.map((day) => {
            const on = days.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                aria-pressed={on}
                className={`min-h-11 min-w-11 rounded-md border px-3 text-sm transition-colors ${
                  on
                    ? "border-secondary bg-secondary text-secondary-foreground"
                    : "border-input bg-card text-muted-foreground hover:bg-accent"
                }`}
              >
                {day.short}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDays(WEEKDAYS)}
          >
            Weekdays
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDays(WEEKEND)}
          >
            Weekends
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}
          >
            Every day
          </Button>
        </div>
        <FieldError
          id="recurring-days-error"
          errors={state.fieldErrors?.daysOfWeek}
        />
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="recurring-start">What hours are typical?</Label>
          <Input
            id="recurring-start"
            name="startTime"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <FieldError
            id="recurring-start-error"
            errors={state.fieldErrors?.startTime}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="recurring-end">Until</Label>
          <Input
            id="recurring-end"
            name="endTime"
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          <FieldError
            id="recurring-end-error"
            errors={state.fieldErrors?.endTime}
          />
        </div>
      </div>

      {/* Exactly the sentence a customer will read, before they commit to it. */}
      {days.length > 0 ? (
        <div className="rounded-lg border border-secondary/50 bg-accent/30 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-brand">
            Customers will see
          </p>
          <p className="mt-1 text-sm">
            Usually here {daysPhrase(days)}, {formatTimeOfDay(start)}–
            {formatTimeOfDay(end)}
          </p>
        </div>
      ) : null}

      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === "success" && state.message ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <SubmitButton pendingLabel="Saving…">
        {existing ? "Save changes" : "Save this spot"}
      </SubmitButton>
    </form>
  );
}
