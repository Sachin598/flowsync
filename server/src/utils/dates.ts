/** Parses "YYYY-MM-DD" as UTC midnight; returns null for malformed or impossible dates (e.g. 2026-02-30). */
export function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}

const DAY = 86400000;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day (YYYY-MM-DD) that an instant falls on in the given IANA time zone. */
export function localDay(instant: Date, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/**
 * Converts an inclusive day range into a half-open UTC interval [start, endExclusive).
 * Time entries store their work day as UTC midnight of that calendar day, so day-granular
 * boundaries never shift with the viewer's or server's time zone.
 */
export function dayRange(from: string, to: string, maxDays = 366): { start: Date; endExclusive: Date } {
  const start = parseDay(from);
  const end = parseDay(to);
  if (!start || !end) throw new RangeError('from and to must be valid YYYY-MM-DD dates');
  if (end < start) throw new RangeError('"to" must not be before "from"');
  if ((end.getTime() - start.getTime()) / DAY + 1 > maxDays) throw new RangeError(`Range is too large (max ${maxDays} days)`);
  return { start, endExclusive: new Date(end.getTime() + DAY) };
}

/**
 * Validates a [from, to) range of instants (used for audit-log queries, where rows carry an exact timestamp).
 * The browser converts the user's local days into instants, so the user's own midnight is the boundary.
 */
export function instantRange(from: Date, to: Date, maxDays = 366): { start: Date; endExclusive: Date } {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new RangeError('from and to must be valid dates');
  if (to <= from) throw new RangeError('"to" must be after "from"');
  if ((to.getTime() - from.getTime()) / DAY > maxDays) throw new RangeError(`Range is too large (max ${maxDays} days)`);
  return { start: from, endExclusive: to };
}
