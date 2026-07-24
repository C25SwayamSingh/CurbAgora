/**
 * Freshness threshold for a vendor-confirmed recurring pattern, in days.
 *
 * The authority is SQL — `location_recurring_stale_after()` decides what a
 * customer actually sees. This mirror exists so the vendor UI can warn someone
 * *before* their spot disappears, which the database has no way to do. If one
 * changes, change both; the pgTAP suite asserts the SQL side.
 */
export const location_recurring_stale_days = 60;

/** How early to start nudging a vendor to reconfirm, in days. */
export const location_recurring_nudge_days = 7;
