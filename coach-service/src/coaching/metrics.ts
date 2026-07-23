/**
 * Computed training/health metrics from the raw Google Sheets data.
 * This is the layer the OpenClaw system never had — it turns logged rows into
 * e1RM, progression slopes, weekly volume-per-muscle, and trends so the coach
 * reasons on real history instead of re-deriving (and hallucinating) "last time."
 */

// ---- estimated 1RM ----
// Epley is accurate to ~10 reps; Brzycki holds better above that. Matt's home
// DBs cap at 45 lb so chest/shoulder work routinely runs 12–20 reps — picking the
// right formula per rep count matters for reading rep-driven progress.
export function e1rm(weight: number, reps: number): number {
  if (!weight || !reps || reps < 1) return 0;
  if (reps === 1) return weight;
  if (reps <= 10) return weight * (1 + reps / 30);
  // Brzycki for 11+; clamp at 20 reps — beyond that it's unreliable and the
  // denominator (37 - reps) explodes/inverts at 37+. Clamp keeps it finite & sane.
  const r = Math.min(reps, 20);
  return weight * (36 / (37 - r));
}

// ---- exercise → muscle map (keyword based; ORDER MATTERS — most specific first,
// and legs/chest are matched BEFORE the generic "press" terms so "leg press" and
// "chest press" aren't miscounted as shoulders). ----
const MUSCLE_RULES: Array<[RegExp, string]> = [
  [/squat|lunge|leg\s?press|leg\s?ext|leg\s?curl|hamstring|quad|calf|rdl|romanian|glute/i, 'legs'],
  [/bench|chest|pec|fly|flye|dip|push.?up|incline\s?(db|dumbbell|barbell|press)/i, 'chest'],
  [/row|pull.?up|pull.?down|lat\s?pull|chin|deadlift|\bback\b/i, 'back'],
  [/shoulder|ohp|overhead|lateral|delt|military|arnold/i, 'shoulders'],
  [/curl|bicep/i, 'biceps'],
  [/tricep|pushdown|skull/i, 'triceps'],
  [/\bab\b|abs|core|plank|crunch|sit.?up/i, 'core'],
];
export function muscleOf(exercise: string): string {
  for (const [re, m] of MUSCLE_RULES) if (re.test(exercise)) return m;
  return 'other';
}

export interface SetLog {
  date: string; // YYYY-MM-DD
  session: string;
  exercise: string;
  weight: number;
  reps: number[]; // per-set reps
  notes?: string;
  rir?: number | null;
}

/** Parse the WORKOUT_DATABASE 2D rows (with header) into typed set logs. */
export function parseWorkoutDb(rows: unknown[][]): SetLog[] {
  if (!rows || rows.length < 2) return [];
  const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase());
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  // Set_4..Set_6 are trailing columns (added 2026-06-10) so 4+-set sessions stop
  // being silently undercounted; older rows simply have them blank.
  const di = col('date'), si = col('session'), ei = col('exercise'),
    wi = col('weight'), s1 = col('set_1'), s2 = col('set_2'), s3 = col('set_3'),
    s4 = col('set_4'), s5 = col('set_5'), s6 = col('set_6'),
    ni = col('notes'), ri = col('rir');
  const out: SetLog[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const ex = String(row[ei] ?? '').trim();
    const dateRaw = String(row[di] ?? '').trim();
    if (!ex || !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) continue; // skip blanks/narrative rows
    const reps = [s1, s2, s3, s4, s5, s6]
      .map((i) => (i >= 0 ? Number(row[i]) : NaN))
      .filter((n) => Number.isFinite(n) && n > 0);
    out.push({
      date: dateRaw,
      session: String(row[si] ?? '').trim(),
      exercise: ex,
      weight: Number(row[wi]) || 0,
      reps,
      notes: ni >= 0 ? String(row[ni] ?? '') : '',
      rir: ri >= 0 && row[ri] !== '' && row[ri] != null ? Number(row[ri]) : null,
    });
  }
  return out;
}

export interface SessionPoint {
  date: string;
  weight: number;
  topReps: number;
  topE1rm: number;
  rir?: number | null;
}

/** Per-session best-set series for one exercise, oldest→newest. */
export function exerciseSeries(logs: SetLog[], exercise: string): SessionPoint[] {
  const re = new RegExp(exercise.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return logs
    .filter((l) => re.test(l.exercise) && l.reps.length)
    .map((l) => {
      const best = l.reps.reduce(
        (acc, reps) => {
          const v = e1rm(l.weight, reps);
          return v > acc.topE1rm ? { topReps: reps, topE1rm: v } : acc;
        },
        { topReps: 0, topE1rm: 0 },
      );
      return { date: l.date, weight: l.weight, topReps: best.topReps, topE1rm: Math.round(best.topE1rm * 10) / 10, rir: l.rir };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Best e1RM for an exercise STRICTLY BEFORE a date (exact-name match, not the
 * substring regex of exerciseSeries — "Curl" must not absorb "Hammer Curl").
 * Returns 0 when there is no prior history. Used for PR detection at log time.
 */
export function bestE1rmBefore(logs: SetLog[], exercise: string, beforeDate: string): number {
  const name = exercise.trim().toLowerCase();
  let best = 0;
  for (const l of logs) {
    if (l.date >= beforeDate) continue;
    if (l.exercise.trim().toLowerCase() !== name) continue;
    for (const r of l.reps) best = Math.max(best, e1rm(l.weight, r));
  }
  return Math.round(best * 10) / 10;
}

/** Linear-regression slope of y over time, expressed per 7 days. */
export function slopePerWeek(points: Array<{ date: string; y: number }>): number {
  const pts = points
    .filter((p) => Number.isFinite(p.y))
    .map((p) => ({ x: Date.parse(p.date + 'T12:00:00') / 86400000, y: p.y }));
  const n = pts.length;
  if (n < 2) return 0;
  const sx = pts.reduce((a, p) => a + p.x, 0);
  const sy = pts.reduce((a, p) => a + p.y, 0);
  const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
  const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return ((n * sxy - sx * sy) / denom) * 7;
}

export function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - Date.parse(dateStr + 'T12:00:00')) / 86400000);
}

/** Weekly "hard set" count per muscle over the trailing `days`. A hard set =
 * a logged working set of ≥5 reps (warmups/empties excluded).
 *
 * NOTE: this is the ROLLING window. Protocol volume decisions must use
 * `hardSetsInRange` over the Mon–Sun calendar week instead — a rolling window
 * drags last week's sets into this week's count. Kept for trailing-trend uses
 * that genuinely want "the last N days" regardless of week boundaries. */
export function weeklyHardSets(logs: SetLog[], days = 7): Record<string, number> {
  const cutoff = Date.now() - days * 86400000;
  const counts: Record<string, number> = {};
  for (const l of logs) {
    if (Date.parse(l.date + 'T12:00:00') < cutoff) continue;
    const hard = l.reps.filter((r) => r >= 5).length;
    if (!hard) continue;
    const m = muscleOf(l.exercise);
    counts[m] = (counts[m] || 0) + hard;
  }
  return counts;
}

/**
 * Hard sets per muscle within an INCLUSIVE ["YYYY-MM-DD", "YYYY-MM-DD"] date
 * range — the calendar-week counter the protocol requires.
 *
 * Back-compat contract: a session is attributed by its LOGGED DATE (the sheet's
 * date / the WORKOUT_DATABASE Date cell), never by a day-of-week label or the
 * sheet's title. A "Monday chest" sheet dated Tuesday counts toward Tuesday's
 * week. Dates are ISO so lexical comparison is chronological — no Date parsing,
 * no tz drift at the week boundary.
 */
export function hardSetsInRange(logs: SetLog[], start: string, end: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const l of logs) {
    if (!l.date || l.date < start || l.date > end) continue;
    const hard = l.reps.filter((r) => r >= 5).length;
    if (!hard) continue;
    const m = muscleOf(l.exercise);
    counts[m] = (counts[m] || 0) + hard;
  }
  return counts;
}

/** Distinct session dates logged within an inclusive date range. */
export function sessionDatesInRange(logs: SetLog[], start: string, end: string): string[] {
  const s = new Set<string>();
  for (const l of logs) if (l.date >= start && l.date <= end) s.add(l.date);
  return [...s].sort();
}

// ---- WHOOP signal helpers -------------------------------------------------
// All take WHOOP_History rows already parsed to {date, ...numeric fields} and
// sorted NEWEST FIRST, matching the snapshot's existing shape.

export interface WhoopRow {
  date: string;
  recovery: number;
  hrv: number;
  rhr: number;
  sleepHours: number;
  strain: number;
}

/** Mean of the finite values, or NaN. */
function mean(xs: number[]): number {
  const f = xs.filter(Number.isFinite);
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : NaN;
}

/**
 * How many CONSECUTIVE most-recent days the trailing-7d HRV average has sat
 * >`thresholdPct`% below the prior 7d average (i.e. days 8–14 back from that
 * day). ≥3 is the protocol's flag.
 *
 * This is an INTENSITY MODIFIER signal only. It is deliberately NOT part of the
 * muscle-retention alarm (see `muscleRetentionAlarm`) — HRV alone never means
 * muscle loss, and conflating them is what produces false "you're losing
 * muscle" calls off a couple of bad nights.
 */
export function hrvDropStreak(rows: WhoopRow[], thresholdPct = 10): { days: number; dropPct: number } {
  let days = 0;
  let firstDrop = NaN;
  // rows[0] = most recent. Day i needs 14 days of history behind it.
  for (let i = 0; i + 14 <= rows.length; i++) {
    const cur = mean(rows.slice(i, i + 7).map((r) => r.hrv));
    const prior = mean(rows.slice(i + 7, i + 14).map((r) => r.hrv));
    if (!Number.isFinite(cur) || !Number.isFinite(prior) || prior <= 0) break;
    const dropPct = ((prior - cur) / prior) * 100;
    if (dropPct <= thresholdPct) break;
    if (i === 0) firstDrop = dropPct;
    days++;
  }
  return { days, dropPct: Number.isFinite(firstDrop) ? Math.round(firstDrop * 10) / 10 : 0 };
}

/**
 * Strain pattern on WORKOUT days only (rest-day strain is meaningless here).
 * Protocol: workout-day strain should sit ~12–15. Consistently <10 =
 * undertrained; >16 on multiple days = recovery debt accumulating.
 */
export function strainPattern(
  rows: WhoopRow[],
  workoutDates: Set<string>,
  days = 14,
): { workoutDays: number; low: number; high: number; avg: number; flag: 'undertrained' | 'recovery_debt' | null } {
  const window = rows.slice(0, days).filter((r) => workoutDates.has(r.date) && Number.isFinite(r.strain));
  const low = window.filter((r) => r.strain < 10).length;
  const high = window.filter((r) => r.strain > 16).length;
  const avg = mean(window.map((r) => r.strain));
  // Need a couple of workout days before calling a pattern anything.
  let flag: 'undertrained' | 'recovery_debt' | null = null;
  if (window.length >= 3 && low >= Math.ceil(window.length / 2)) flag = 'undertrained';
  if (high >= 2) flag = 'recovery_debt'; // recovery debt outranks
  return {
    workoutDays: window.length,
    low,
    high,
    avg: Number.isFinite(avg) ? Math.round(avg * 10) / 10 : NaN,
    flag,
  };
}

// ---- Muscle-retention alarm ----------------------------------------------

/**
 * Key lifts whose e1RM has regressed across 2+ CONSECUTIVE recent sessions.
 * "Regressing" = each of the last `sessions` points is below the one before it.
 * One bad session is noise; a monotone slide is signal.
 */
export function regressingLifts(logs: SetLog[], lifts: string[], sessions = 3): string[] {
  const out: string[] = [];
  for (const lift of lifts) {
    const s = exerciseSeries(logs, lift).slice(-sessions);
    if (s.length < 3) continue; // need a baseline + 2 declining sessions
    let declines = 0;
    for (let i = 1; i < s.length; i++) if (s[i].topE1rm < s[i - 1].topE1rm) declines++;
    if (declines >= 2) out.push(lift);
  }
  return out;
}

export interface RetentionInputs {
  regressing: string[]; // lifts regressing 2+ consecutive sessions
  muscleMassSlope: number; // lb/week over the last 2 weeks (NaN if unknown)
  weightSlope: number; // lb/week (NaN if unknown)
}

/**
 * The muscle-retention alarm. Fires ONLY when ALL THREE conditions hold:
 *   1. e1RM regressing on 2+ key lifts over 2+ consecutive sessions
 *   2. Withings muscle mass trending down over a 2-week window
 *   3. Bodyweight also dropping
 *
 * Any one or two of these is NOT an alarm — it is at most a watch item. In
 * particular an HRV drop is not an input here at all.
 */
export function muscleRetentionAlarm(i: RetentionInputs): { firing: boolean; met: string[]; missing: string[] } {
  const checks: Array<[string, boolean]> = [
    [`e1RM regressing on ${i.regressing.length} lift(s)`, i.regressing.length >= 2],
    ['muscle mass down 2wk', Number.isFinite(i.muscleMassSlope) && i.muscleMassSlope < -0.1],
    ['weight dropping', Number.isFinite(i.weightSlope) && i.weightSlope < -0.1],
  ];
  const met = checks.filter(([, v]) => v).map(([k]) => k);
  const missing = checks.filter(([, v]) => !v).map(([k]) => k);
  return { firing: missing.length === 0, met, missing };
}

/** Volume-landmark bands (hard sets/week). Bias: chest/upper priority,
 * legs maintenance (already developed), low-responder-in-deficit ranges. */
export const VOLUME_BANDS: Record<string, { mev: number; mav: number; mrv: number }> = {
  chest: { mev: 10, mav: 16, mrv: 20 },
  back: { mev: 10, mav: 16, mrv: 20 },
  shoulders: { mev: 8, mav: 14, mrv: 18 },
  biceps: { mev: 6, mav: 12, mrv: 16 },
  triceps: { mev: 6, mav: 12, mrv: 16 },
  legs: { mev: 6, mav: 10, mrv: 14 }, // maintenance — bank recovery for upper
  core: { mev: 0, mav: 8, mrv: 12 },
};
