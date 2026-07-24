import { z } from "zod";

/**
 * Validation for the two vendor-authored location kinds: a recurring pattern
 * ("weekdays 11–3 at this corner") and a one-off scheduled appearance.
 *
 * Deliberately vendor-shaped, not database-shaped. A cart owner enters days,
 * hours, and a place; they never see verification enums, source provenance, or
 * the freshness threshold. Those are decided server-side from *who* wrote the
 * row, which is the only trustworthy signal — a client that could name its own
 * source type could name itself authoritative.
 */

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

/** 0 = Sunday … 6 = Saturday, matching Postgres `extract(dow)`. */
export const DAYS_OF_WEEK: { value: number; label: string; short: string }[] = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [0, 6];

const coordinates = {
  latitude: z.coerce
    .number({ message: "Pick a location on the map or use your current spot" })
    .min(-90)
    .max(90),
  longitude: z.coerce
    .number({ message: "Pick a location on the map or use your current spot" })
    .min(-180)
    .max(180),
};

const publicLabel = z
  .string()
  .trim()
  .min(1, 'Name the spot, e.g. "Corner of 5th & Main"')
  .max(140, "Keep it under 140 characters");

/**
 * Validated as a real IANA zone the browser can resolve. The database checks
 * this again by actually resolving it — this layer exists to give the vendor a
 * readable error instead of a raised exception.
 */
const timezone = z
  .string()
  .trim()
  .min(1, "Time zone is required")
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "That time zone isn't recognized");

/** "HH:MM" from a native time input. */
const timeOfDay = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time like 11:00");

export const recurringLocationSchema = z
  .object({
    unitId: z.string().trim().min(1, "Choose which cart or truck this is for"),
    publicLabel,
    ...coordinates,
    timezone,
    daysOfWeek: z
      .array(z.coerce.number().int().min(0).max(6))
      .min(1, "Pick at least one day")
      .max(7),
    startTime: timeOfDay,
    endTime: timeOfDay,
    effectiveFrom: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
    effectiveTo: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  })
  // Overnight windows are a real thing carts do, but they need their own
  // handling in the ranking query. Refusing them here is honest; silently
  // storing one that never matches would not be.
  .refine((v) => v.endTime > v.startTime, {
    message:
      "End time must be after start time. Overnight hours aren't supported yet.",
    path: ["endTime"],
  })
  .refine(
    (v) =>
      !v.effectiveTo || !v.effectiveFrom || v.effectiveTo >= v.effectiveFrom,
    {
      message: "End date must be on or after the start date",
      path: ["effectiveTo"],
    },
  );

export type RecurringLocationInput = z.infer<typeof recurringLocationSchema>;

export const scheduledAppearanceSchema = z
  .object({
    unitId: z.string().trim().min(1, "Choose which cart or truck this is for"),
    publicLabel,
    ...coordinates,
    timezone,
    eventName: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .max(120, "Keep the event name under 120 characters")
        .optional(),
    ),
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    startTime: timeOfDay,
    endTime: timeOfDay,
  })
  .refine((v) => v.endTime > v.startTime, {
    message: "End time must be after start time",
    path: ["endTime"],
  });

export type ScheduledAppearanceInput = z.infer<
  typeof scheduledAppearanceSchema
>;

/**
 * Combine a local date, a wall-clock time, and a zone into a real instant.
 *
 * A vendor saying "Friday at 5pm" means 5pm where their cart is. Building the
 * timestamp from the offset that zone had *on that date* is what makes the
 * stored instant survive a daylight-saving boundary — constructing it from the
 * current offset would be wrong for any date on the other side of one.
 */
export function zonedTimestamp(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  // Start from the naive UTC reading, then correct by that zone's offset at
  // approximately that moment.
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetMs = zoneOffsetMs(new Date(naiveUtc), timeZone);
  return new Date(naiveUtc - offsetMs);
}

/** A zone's UTC offset in milliseconds at a given instant. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const read = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second"),
  );
  return asUtc - at.getTime();
}

export function recurringFormValues(formData: FormData) {
  return {
    unitId: formData.get("unitId"),
    publicLabel: formData.get("publicLabel"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    timezone: formData.get("timezone"),
    daysOfWeek: formData.getAll("daysOfWeek"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    effectiveFrom: formData.get("effectiveFrom"),
    effectiveTo: formData.get("effectiveTo"),
  };
}

export function scheduledFormValues(formData: FormData) {
  return {
    unitId: formData.get("unitId"),
    publicLabel: formData.get("publicLabel"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    timezone: formData.get("timezone"),
    eventName: formData.get("eventName"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
  };
}

/** "weekdays" / "weekends" / "Tue & Thu" — mirrors location_days_phrase in SQL. */
export function daysPhrase(days: number[]): string {
  const set = new Set(days);
  const hasAllWeekdays = WEEKDAYS.every((d) => set.has(d));
  const hasAnyWeekend = WEEKEND.some((d) => set.has(d));
  const hasAllWeekend = WEEKEND.every((d) => set.has(d));
  const hasAnyWeekday = WEEKDAYS.some((d) => set.has(d));

  if (set.size === 7) return "every day";
  if (hasAllWeekdays && !hasAnyWeekend) return "weekdays";
  if (hasAllWeekend && !hasAnyWeekday) return "weekends";
  return DAYS_OF_WEEK.filter((d) => set.has(d.value))
    .map((d) => d.short)
    .join(" & ");
}

/** "11:00" → "11:00 AM", for previewing exactly what a customer will read. */
export function formatTimeOfDay(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}
