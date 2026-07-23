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

/** "YYYY-MM-DD" + n days (n may be negative). Anchored at noon to dodge DST edges. */
export function addDaysStr(date: string, n: number): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  return new Date(t + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Day-of-week index in the given tz: 0=Sun … 6=Sat. */
export function weekdayInTz(tz: string, when: Date = new Date()): number {
  const w = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(when);
  return DOW.indexOf(w);
}

/**
 * Day-of-week index (0=Sun … 6=Sat) for a "YYYY-MM-DD" string. Anchored at UTC
 * noon so it is tz-independent: the label belongs to the DATE, not to a clock.
 */
export function weekdayOf(date: string): number {
  const t = Date.parse(`${date}T12:00:00Z`);
  return Number.isNaN(t) ? -1 : new Date(t).getUTCDay();
}

/** Short weekday label ("Mon") for a "YYYY-MM-DD" string; '' when unparseable. */
export function weekdayLabel(date: string): string {
  const i = weekdayOf(date);
  return i >= 0 ? DOW[i] : '';
}

/**
 * The strict Mon–Sun calendar week containing `when`, as inclusive
 * "YYYY-MM-DD" bounds in `tz`.
 *
 * The protocol counts volume per CALENDAR week (resets Monday), not over a
 * rolling 7-day window — a rolling window silently drags the previous week's
 * Friday sets into Monday's count and corrupts autoregulation decisions.
 * Sunday (dow 0) belongs to the week that started the previous Monday, i.e.
 * 6 days back, not the day after tomorrow.
 */
export function calendarWeek(tz: string, when: Date = new Date()): { start: string; end: string } {
  const today = todayStr(tz, when);
  const dow = weekdayInTz(tz, when);
  const backToMonday = dow === 0 ? 6 : dow - 1;
  const start = addDaysStr(today, -backToMonday);
  return { start, end: addDaysStr(start, 6) };
}

/** Local hour (0–23) in `tz` for an ISO timestamp; NaN when unparseable. */
export function hourOfTimestamp(iso: string, tz: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return NaN;
  return hourInTz(tz, new Date(t));
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
