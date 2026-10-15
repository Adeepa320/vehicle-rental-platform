/**
 * Calendar-day helpers in Sri Lanka time (Asia/Colombo, UTC+05:30, no DST).
 * Instants are stored in UTC; anything expressed as "a day" (document expiry,
 * report ranges, search dates) is a Colombo calendar day (CLAUDE.md §6).
 */

/** `YYYY-MM-DD` of `now` in Asia/Colombo. */
export function colomboDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Whole days from `fromDay` to `toDay` (both `YYYY-MM-DD`); negative when `toDay` is earlier. */
export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round(
    (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000,
  );
}

/** Adds `days` to a `YYYY-MM-DD` day. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
