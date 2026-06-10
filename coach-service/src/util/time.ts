/**
 * Timezone-aware date helpers. We avoid pulling in a date library; Intl handles
 * the tz formatting we need.
 */

/** "YYYY-MM-DD" for the given IANA tz (default: now). */
export function todayStr(tz: string, when: Date = new Date()): string {
  // en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when);
}

export function yesterdayStr(tz: string): string {
  return todayStr(tz, new Date(Date.now() - 24 * 60 * 60 * 1000));
}

/** Human-readable local time, e.g. "Mon Jun 8, 6:52 AM". */
export function nowInTz(tz: string, when: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(when);
}

/** The local hour (0–23) in the given tz. */
export function hourInTz(tz: string, when: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  }).format(when);
  return parseInt(h, 10) % 24;
}

/**
 * Build a Google-Calendar-friendly local datetime string for a given date +
 * "HH:MM" wall-clock time, to be sent alongside an explicit timeZone field.
 * e.g. localDateTime("2026-06-09", "05:30") => "2026-06-09T05:30:00".
 */
export function localDateTime(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return `${date}T${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}:00`;
}

/** Minutes since epoch helper for cooldown math. */
export function minutesSince(tsMs: number | undefined): number {
  if (!tsMs) return Infinity;
  return (Date.now() - tsMs) / 60000;
}

/** Returns true if the metadata timestamp is fresh (within `maxAgeHours`). */
export function isFresh(updatedAt: string | undefined, maxAgeHours = 2): boolean {
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= maxAgeHours * 60 * 60 * 1000;
}
