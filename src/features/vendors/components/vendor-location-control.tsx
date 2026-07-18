"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, ExternalLink, MapPin } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { SubmitButton } from "@/features/authentication/components/submit-button";
import {
  endLocationSessionAction,
  startLocationSessionAction,
  updateLocationSessionAction,
} from "@/features/vendors/location-actions";
import type { VendorLocationSession } from "@/lib/supabase/database.types";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Today plus this many following days are offered as "expected end" days. */
const END_DAYS_AHEAD = 5;

function endDayOptions() {
  const options: { value: string; label: string }[] = [];
  for (let offset = 0; offset <= END_DAYS_AHEAD; offset++) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const label =
      offset === 0
        ? "Today"
        : offset === 1
          ? "Tomorrow"
          : date.toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            });
    options.push({ value: String(offset), label });
  }
  return options;
}

/**
 * All 48 half-hour slots in a day ("HH:mm") — carts commonly stay open
 * past midnight, so every day offers the full 24 hours rather than only
 * hours later than "now". Past-relative-to-now moments are handled by
 * composeExpectedEnd's rollover, not by hiding options here.
 */
function endTimeSlots() {
  const slots: { value: string; label: string }[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of [0, 30]) {
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      slots.push({
        value,
        label: new Date(2000, 0, 1, hour, minute).toLocaleTimeString(
          undefined,
          { hour: "numeric", minute: "2-digit" },
        ),
      });
    }
  }
  return slots;
}

/**
 * Local-time "YYYY-MM-DDTHH:mm" for the hidden expectedEndAt field. When
 * "Today" plus an hour earlier than the current time is picked, that
 * naturally means "later tonight, after midnight" (a lot of carts run
 * past 12am) — rolling the composed moment forward one day captures that
 * without asking the vendor to think about calendar-day boundaries.
 */
function composeExpectedEnd(dayOffset: string, time: string) {
  if (dayOffset === "" || time === "") {
    return "";
  }
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date();
  date.setDate(date.getDate() + Number(dayOffset));
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

/**
 * Dashboard "Go live" control for one vendor unit. Browser geolocation
 * requires the browser's own permission prompt before a position is ever
 * captured — that native prompt is the only consent UI needed here.
 */
export function VendorLocationControl({
  unitId,
  session,
}: {
  unitId: string;
  session: VendorLocationSession | null;
}) {
  const isUpdating = Boolean(session);
  const [state, formAction] = useActionState(
    isUpdating ? updateLocationSessionAction : startLocationSessionAction,
    idleState,
  );
  const [endState, endFormAction] = useActionState(
    endLocationSessionAction,
    idleState,
  );

  const [capturing, setCapturing] = React.useState(false);
  const [coords, setCoords] = React.useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [geoError, setGeoError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  // Expected end time as separate day + time selects (native selects
  // render as scroll wheels on phones) — no calendar popup involved.
  const [endDay, setEndDay] = React.useState("");
  const [endTime, setEndTime] = React.useState("");

  // Hide the form only once the action genuinely succeeds — not on
  // submit, or a validation/database error would vanish along with the
  // form before the vendor ever saw it. Adjusted during render per
  // https://react.dev/learn/you-might-not-need-an-effect.
  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.status === "success") {
      setShowForm(false);
      setCoords(null);
      setEndDay("");
      setEndTime("");
    }
  }

  function handleEndDayChange(value: string) {
    setEndDay(value);
    if (value === "") {
      setEndTime("");
      return;
    }
    if (endTime === "") {
      // Default to 8:00 PM — a typical vending close. If that moment has
      // already passed today, composeExpectedEnd rolls it to tonight
      // after midnight / tomorrow evening, so this default is always
      // meaningful without the vendor needing to think about it.
      setEndTime("20:00");
    }
  }

  function captureLocation() {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("Your browser doesn't support location sharing.");
      return;
    }
    setCapturing(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setShowForm(true);
        setCapturing(false);
      },
      (error) => {
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Allow location access in your browser to go live."
            : "Couldn't get your current location. Please try again.",
        );
        setCapturing(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  if (showForm) {
    return (
      <form
        action={formAction}
        className="space-y-3 rounded-lg border border-border p-3"
      >
        {state.status === "error" && state.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        <input type="hidden" name="unitId" value={unitId} />
        {session ? (
          <input type="hidden" name="sessionId" value={session.id} />
        ) : null}
        <input type="hidden" name="latitude" value={coords?.lat ?? ""} />
        <input type="hidden" name="longitude" value={coords?.lng ?? ""} />
        <div className="space-y-1">
          <Label htmlFor={`publicLabel-${unitId}`} className="text-xs">
            Describe where you are
          </Label>
          <Input
            id={`publicLabel-${unitId}`}
            name="publicLabel"
            placeholder="e.g. Corner of 5th & Main"
            required
            maxLength={140}
            defaultValue={session?.public_label ?? ""}
            aria-describedby={`publicLabel-error-${unitId}`}
          />
          <FieldError
            id={`publicLabel-error-${unitId}`}
            errors={state.fieldErrors?.publicLabel}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`expectedEndDay-${unitId}`} className="text-xs">
            Open until (optional)
          </Label>
          <input
            type="hidden"
            name="expectedEndAt"
            value={composeExpectedEnd(endDay, endTime)}
          />
          <div className="flex gap-2">
            <Select
              id={`expectedEndDay-${unitId}`}
              aria-label="Day"
              value={endDay}
              onChange={(event) => handleEndDayChange(event.target.value)}
              className="flex-1"
              aria-describedby={`expectedEndAt-error-${unitId}`}
            >
              <option value="">No end time</option>
              {endDayOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {endDay !== "" ? (
              <Select
                aria-label="Time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className="flex-1"
                aria-describedby={`expectedEndAt-error-${unitId}`}
              >
                {endTimeSlots().map((slot) => (
                  <option key={slot.value} value={slot.value}>
                    {slot.label}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          <FieldError
            id={`expectedEndAt-error-${unitId}`}
            errors={state.fieldErrors?.expectedEndAt}
          />
        </div>
        <div className="flex gap-2">
          <SubmitButton
            size="sm"
            pendingLabel={isUpdating ? "Updating…" : "Going live…"}
          >
            {isUpdating ? "Save update" : "Confirm and go live"}
          </SubmitButton>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowForm(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (session) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-live">
          <MapPin className="size-4" aria-hidden="true" />
          Live now
        </p>
        <p className="text-sm text-muted-foreground">
          Since {formatTime(session.started_at)}
          {session.expected_end_at
            ? ` · expected until ${formatTime(session.expected_end_at)}`
            : ""}
        </p>
        <p className="text-sm">{session.public_label}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Tracked at {session.latitude.toFixed(5)},{" "}
          {session.longitude.toFixed(5)}
          <a
            href={`https://www.google.com/maps?q=${session.latitude},${session.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-live underline underline-offset-2"
          >
            Open in Maps
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={captureLocation}
            disabled={capturing}
          >
            {capturing ? "Locating…" : "Update location"}
          </Button>
          <form action={endFormAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <SubmitButton variant="outline" size="sm" pendingLabel="Ending…">
              End session
            </SubmitButton>
          </form>
        </div>
        {endState.status === "error" && endState.message ? (
          <Alert variant="destructive">
            <AlertDescription>{endState.message}</AlertDescription>
          </Alert>
        ) : null}
        {geoError ? (
          <Alert variant="destructive">
            <AlertDescription>{geoError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm text-muted-foreground">Not live right now.</p>
      <Button
        type="button"
        size="sm"
        onClick={captureLocation}
        disabled={capturing}
      >
        <MapPin aria-hidden="true" />
        {capturing ? "Locating…" : "Go live at my current location"}
      </Button>
      {geoError ? (
        <Alert variant="destructive">
          <AlertDescription>{geoError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
