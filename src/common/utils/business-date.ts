/**
 * Calendar days are business days in Vietnam (UTC+7, no daylight saving time).
 * Used for the desired receive date and for "from/to" order date filters, so that
 * "2026-10-07" means that day in Vietnam, not in UTC.
 */
export const BUSINESS_UTC_OFFSET = '+07:00';
const OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's date in Vietnam, YYYY-MM-DD. */
export function businessToday(now = new Date()): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD shifted by `days`. */
export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export const startOfBusinessDay = (date: string) =>
  new Date(`${date}T00:00:00.000${BUSINESS_UTC_OFFSET}`);

export const endOfBusinessDay = (date: string) =>
  new Date(`${date}T23:59:59.999${BUSINESS_UTC_OFFSET}`);

/** A DATE column value (UTC midnight from Prisma) as YYYY-MM-DD. */
export const toDateOnly = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

/** YYYY-MM-DD as the Date Prisma stores in a DATE column. */
export const fromDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** A timestamp shifted so that its UTC fields show the Vietnam wall-clock time (for Excel). */
export const toBusinessWallClock = (value: Date) => new Date(value.getTime() + OFFSET_MS);
