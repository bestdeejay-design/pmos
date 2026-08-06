/**
 * Delivery policy for agent messages: DND (do-not-disturb) window and a daily
 * message cap. Pure, stateless helpers — unit-testable without a DB or clock.
 *
 * Both are fail-open: if the env var is unset or malformed, no restriction is
 * applied, so default behaviour is identical to today.
 */

/** True if `hourUtc` (0–23) falls inside the DND window described by `window`.
 *  Format: "HH-HH" (e.g. "22-8" = 22:00–08:00). A wrap-around window wraps
 *  across midnight (start > end). start === end → no restriction. Invalid/missing →
 *  no restriction. */
export function inDndWindow(hourUtc: number, window: string | undefined): boolean {
  if (!window) return false;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(window.trim());
  if (!m) return false;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start > 23 || end > 23) return false;
  if (start === end) return false;
  if (start < end) return hourUtc >= start && hourUtc < end;
  return hourUtc >= start || hourUtc < end; // wraps midnight
}

/** True when the daily cap has not been reached yet. Fail-open: no limit or a
 *  non-positive limit → always allowed. */
export function dailyAllowed(countByDay: number, limit: number | undefined): boolean {
  if (limit === undefined || limit <= 0) return true;
  return countByDay < limit;
}

/** Parse AGENT_DAILY_LIMIT into a positive integer, or undefined (fail-open). */
export function parseDailyLimit(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** ISO string of UTC midnight of the current UTC day — the daily-count window start. */
export function todayStartUtcIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}