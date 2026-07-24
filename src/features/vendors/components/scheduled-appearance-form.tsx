"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Loader2, LocateFixed } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { SubmitButton } from "@/features/authentication/components/submit-button";
import { createScheduledAppearanceAction } from "@/features/vendors/schedule-actions";
import { formatTimeOfDay } from "@/features/vendors/schedule-schemas";

/** A one-off appearance: a market, a festival, a private booking. */
export function ScheduledAppearanceForm({
  unitId,
  onDone,
}: {
  unitId: string;
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState(
    createScheduledAppearanceAction,
    idleState,
  );

  const [date, setDate] = React.useState("");
  const [start, setStart] = React.useState("17:00");
  const [end, setEnd] = React.useState("21:00");
  const [coords, setCoords] = React.useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [geoError, setGeoError] = React.useState<string | null>(null);

  const [timezone] = React.useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  );

  React.useEffect(() => {
    if (state.status === "success") onDone?.();
  }, [state.status, onDone]);

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
          "Couldn't get your location. Allow location access and retry.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="unitId" value={unitId} />
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="latitude" value={coords?.lat ?? ""} />
      <input type="hidden" name="longitude" value={coords?.lng ?? ""} />

      <div className="space-y-1.5">
        <Label htmlFor="sched-label">Where will you be?</Label>
        <Input
          id="sched-label"
          name="publicLabel"
          placeholder="Riverside night market"
          maxLength={140}
          aria-describedby="sched-label-error"
        />
        <FieldError
          id="sched-label-error"
          errors={state.fieldErrors?.publicLabel}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sched-event">Event name (optional)</Label>
        <Input
          id="sched-event"
          name="eventName"
          placeholder="Summer food festival"
          maxLength={120}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sched-coords">Pin the spot</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            id="sched-coords"
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
            {coords ? "Update pin" : "Use my current spot"}
          </Button>
          {coords ? (
            <span className="text-xs text-success">
              Pinned ({coords.lat.toFixed(4)}, {coords.lng.toFixed(4)})
            </span>
          ) : null}
        </div>
        {geoError ? (
          <p className="text-xs text-destructive">{geoError}</p>
        ) : null}
        <FieldError
          id="sched-coords-error"
          errors={state.fieldErrors?.latitude}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sched-date">When will you be there?</Label>
        <Input
          id="sched-date"
          name="date"
          type="date"
          min={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <FieldError id="sched-date-error" errors={state.fieldErrors?.date} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sched-start">From</Label>
          <Input
            id="sched-start"
            name="startTime"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <FieldError
            id="sched-start-error"
            errors={state.fieldErrors?.startTime}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sched-end">Until</Label>
          <Input
            id="sched-end"
            name="endTime"
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          <FieldError
            id="sched-end-error"
            errors={state.fieldErrors?.endTime}
          />
        </div>
      </div>

      {date ? (
        <div className="rounded-lg border border-secondary/50 bg-accent/30 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-brand">
            Customers will see
          </p>
          <p className="mt-1 text-sm">
            Scheduled {date}, {formatTimeOfDay(start)}–{formatTimeOfDay(end)}
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

      <SubmitButton pendingLabel="Adding…">Add appearance</SubmitButton>
    </form>
  );
}
