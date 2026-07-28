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

/**
 * Warm-up / ramp / prehab rows. These are logged in the sheet like any other
 * exercise but are NOT hard sets, and the protocol is explicit that the Friday
 * PT work is prehab and "not counted toward core MAV sets". Counting them
 * inflates weekly volume and, worse, makes a muscle look trained when it only
 * got mobility work.
 */
const WARMUP_RE =
  /^warm[-\s]?up\b|^ramp\b|\bramp\s*\d+\s*$|prehab|\bcars?\b|quadruped|prone\s?press.?ups?|plank\s?rocks?|tsp\s?rotation|chin\s?retraction/i;

export function isWarmup(exercise: string): boolean {
  return WARMUP_RE.test(exercise.trim());
}

/**
 * exercise → muscle map (keyword based). ORDER IS LOAD-BEARING; each rule below
 * exists because a real logged exercise name was landing in the wrong bucket:
 *
 *  - core BEFORE back: "Ab Crunch machine" matched back's old bare `chin`
 *    pattern via ma-CHIN-e. (That bare `chin` is now `chin.?up`.)
 *  - triceps BEFORE chest: "Tricep Dip" was chest via `dip`.
 *  - triceps BEFORE shoulders: "Overhead Cable Tricep Extension" was shoulders
 *    via `overhead`.
 *  - legs BEFORE biceps: "Leg Curl" must not match `curl`.
 *  - biceps BEFORE chest: "Incline DB Curl" was chest via `incline (db|…)` —
 *    six sessions of arm work counted as chest volume.
 *  - chest must match FLAT/decline presses too, not just incline: "Flat DB
 *    Press" was falling through to 'other' and vanishing from the count.
 *  - shoulders owns `face pull` (rear delt); it was falling through to 'other'
 *    across 10 sessions.
 */
const MUSCLE_RULES: Array<[RegExp, string]> = [
  [/pallof|ab\s?wheel|dead\s?bug|hollow|russian\s?twist|(leg|knee)\s?raise|crunch|plank|sit.?up|\babs?\b|core|farmer|bird\s?dog/i, 'core'],
  // Rear-delt work reads as shoulders, not chest, even though it says "fly".
  [/rear.?delt|reverse.?(fly|flye|pec|delt)|rear.?fly/i, 'shoulders'],
  [/tricep|pushdown|push\s?down|skull|kickback|(overhead|french).*(ext|extension)/i, 'triceps'],
  // Posterior-chain / low-back: back-ext, hyper, good-morning, reverse hyper.
  // Grouped with legs (glute/ham/erector) so they never read as lat "back".
  // Deadlift variants live here (posterior chain), consistent with RDL and how
  // Matt tracks them — a plain/trap-bar/sumo deadlift is a leg exercise, not a
  // lat exercise. (Was previously in the back rule, so "Deadlift" mis-counted.)
  [/squat|lunge|leg\s?press|leg\s?ext|leg\s?curl|hamstring|quad|calf|rdl|romanian|deadlift|glute|hip\s?thrust|thigh|abduct|adduct|(back|hyper)\s?ext|hyperext|reverse\s?hyper|good\s?morning/i, 'legs'],
  [/curl|bicep/i, 'biceps'],
  // "row" anywhere ⇒ back (catches "Chest Supported Row" before the chest rule).
  [/\brow\b|pull.?up|pull.?down|lat\s?pull|chin.?up|\bback\b|shrug|pullover/i, 'back'],
  [/bench|chest|pec|\bfly|flye|\bdip|push.?up|(incline|flat|decline).*(press|bench|fly)|incline\s?(db|dumbbell|barbell)\s*$/i, 'chest'],
  [/shoulder|ohp|overhead|lateral|delt|military|arnold|face.?pull|upright|landmine/i, 'shoulders'],
];

/**
 * User-taught classifications, keyed by lowercased exercise name. These WIN over
 * the regex rules — when Matt tells Vic what muscle a novel exercise hits, that
 * answer is authoritative and must stick, so a misclassification can never
 * silently persist for an exercise the rules don't know. Hydrated at startup and
 * after each write via setMuscleOverrides(); empty until then (pure default).
 */
let OVERRIDES: Record<string, string> = {};
export function setMuscleOverrides(map: Record<string, string>): void {
  OVERRIDES = {};
  for (const [k, v] of Object.entries(map || {})) OVERRIDES[k.trim().toLowerCase()] = v;
}

export const KNOWN_MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'warmup'] as const;

/** Muscle group for an exercise; 'warmup' for prehab/ramp rows (never counted). */
export function muscleOf(exercise: string): string {
  const key = exercise.trim().toLowerCase();
  if (OVERRIDES[key]) return OVERRIDES[key]; // user-taught wins over everything
  if (isWarmup(exercise)) return 'warmup';
  for (const [re, m] of MUSCLE_RULES) if (re.test(exercise)) return m;
  return 'other';
}

/**
 * Distinct exercise names in the given logs that the classifier can't place
 * (fall through to 'other') and that have not been user-taught. These are the
 * novel/unclassified exercises Vic must ask Matt about before their volume can
 * count — the auto-detectable gap. A misclassification into a real-but-wrong
 * muscle can't be caught here (the regex is confident), which is why Matt's
 * taught overrides always win.
 */
export function unclassifiedExercises(logs: SetLog[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of logs) {
    const name = l.exercise.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    if (muscleOf(name) === 'other') out.push(name);
  }
  return out;
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

/**
 * The weight to actually prescribe for a lift, grounded in its ESTABLISHED
 * working weight rather than the single most-recent number.
 *
 * Why this exists: Hammer Curl was logged at 15 lb for seven straight sessions,
 * then once at 30×8 — and the next workout prescribed 30, treating a one-off
 * aggressive jump as the new baseline. The established weight (a load hit in ≥2
 * of the recent sessions) is 15; 30 is an UNVERIFIED +100% jump and should not
 * be prescribed as a target. Contrast Leg Press 180→190→200: 200 is only +11%
 * over the established 180, a normal progression, so it's verified.
 *
 * Rule: unverified when the last weight is >15% above the established weight and
 * was hit in only one recent session. Suggested target = the last weight when
 * verified, else the established weight (progress reps there first). Never
 * returns a blank — if there's any history, there's a number to prefill, which
 * also stops "logged before but no starting weight" gaps.
 */
export interface ProgressionTarget {
  establishedWeight: number; // load hit in ≥2 recent sessions (else the min recent)
  lastWeight: number;
  lastReps: number;
  jumpPct: number; // last vs established, %
  verified: boolean; // is the last weight a trustworthy working weight?
  suggestedWeight: number; // what to prefill
  note: string;
}
export function progressionTarget(series: SessionPoint[], recentN = 6): ProgressionTarget | null {
  if (!series.length) return null;
  const recent = series.slice(-recentN);
  const last = recent[recent.length - 1];
  // Established = the highest weight appearing in ≥2 recent sessions; if nothing
  // repeats, the lowest recent weight (the clearly-owned load).
  const counts = new Map<number, number>();
  for (const p of recent) counts.set(p.weight, (counts.get(p.weight) ?? 0) + 1);
  const repeated = [...counts.entries()].filter(([, c]) => c >= 2).map(([w]) => w);
  const established = repeated.length ? Math.max(...repeated) : Math.min(...recent.map((p) => p.weight));
  const jumpPct = established > 0 ? Math.round(((last.weight - established) / established) * 100) : 0;
  const lastTimesSeen = counts.get(last.weight) ?? 0;
  const verified = last.weight <= established || jumpPct <= 15 || lastTimesSeen >= 2;
  const suggestedWeight = verified ? last.weight : established;
  const note = verified
    ? `Working weight ${suggestedWeight}. Last ${last.weight}×${last.topReps}.`
    : `Last ${last.weight}×${last.topReps} is an UNVERIFIED +${jumpPct}% jump over the established ${established} (hit once). ` +
      `Prescribe ${established} and progress reps/verify before loading up.`;
  return { establishedWeight: established, lastWeight: last.weight, lastReps: last.topReps, jumpPct, verified, suggestedWeight, note };
}

export function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - Date.parse(dateStr + 'T12:00:00')) / 86400000);
}

/**
 * A "hard set" within one exercise's logged reps. No rep-count floor: Matt
 * never plans a set under 5 reps, so any logged set that low is a failure to
 * hit the target under fatigue, not a warmup ramp — still a hard set (Matt:
 * "i only did 4 because thats all i could do, they were hard" / "the only
 * time ill mark a set under 5 reps is if I fail to meet the target").
 */
function hardSetCount(reps: number[]): number {
  return reps.filter((r) => r >= 1).length;
}

/** Weekly "hard set" count per muscle over the trailing `days`. See
 * `hardSetCount` for what counts as a hard set (warmups/empties excluded).
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
    const hard = hardSetCount(l.reps);
    if (!hard) continue;
    const m = muscleOf(l.exercise);
    if (m === 'warmup') continue; // prehab/ramp rows are not hard sets
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
    const hard = hardSetCount(l.reps);
    if (!hard) continue;
    const m = muscleOf(l.exercise);
    if (m === 'warmup') continue; // prehab/ramp rows are not hard sets
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
  // WHOOP_History is appended opportunistically and has real gaps (and dupes),
  // so "the last 14 ROWS" is not "the last 14 DAYS" — without this guard a
  // 3-day streak could silently span months of sparse records.
  for (let i = 0; i + 14 <= rows.length; i++) {
    const spanDays = daysSince(rows[i + 13].date) - daysSince(rows[i].date);
    if (spanDays > 21) break; // too sparse to call a consecutive-day streak
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
 * Protocol: workout-day strain should sit ~12–15. >16 on multiple days =
 * recovery debt accumulating.
 *
 * ASYMMETRIC ON PURPOSE. WHOOP_History rows are written by the MORNING job, so
 * the Strain cell holds strain-*so-far-at-~5am*, not the day's total (observed
 * values of 0.07/1.46 on real training days). Low readings are therefore
 * uninterpretable — they cannot distinguish "rest day", "easy session", and
 * "captured before he trained". So:
 *   - HIGH (>16) is trusted: a morning capture can never reach 16, so a high
 *     reading is necessarily a real high-strain day.
 *   - LOW (<10) is NOT flagged as undertrained — that fires on every
 *     morning-captured row and would tell Matt to add intensity off an
 *     artifact. `lowConfidence` marks the sample instead.
 * If end-of-day strain capture is added later, drop `lowConfidence` and
 * re-enable the undertrained branch.
 */
export function strainPattern(
  rows: WhoopRow[],
  workoutDates: Set<string>,
  days = 14,
): {
  workoutDays: number;
  low: number;
  high: number;
  avg: number;
  lowConfidence: boolean;
  flag: 'recovery_debt' | null;
} {
  const window = rows
    .filter((r) => daysSince(r.date) <= days)
    .filter((r) => workoutDates.has(r.date) && Number.isFinite(r.strain));
  const low = window.filter((r) => r.strain < 10).length;
  const high = window.filter((r) => r.strain > 16).length;
  const avg = mean(window.map((r) => r.strain));
  // An average this far below a real training day means we are looking at
  // morning snapshots, not day totals.
  const lowConfidence = window.length > 0 && Number.isFinite(avg) && avg < 8;
  return {
    workoutDays: window.length,
    low,
    high,
    avg: Number.isFinite(avg) ? Math.round(avg * 10) / 10 : NaN,
    lowConfidence,
    flag: high >= 2 ? 'recovery_debt' : null,
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

/**
 * Volume-landmark bands (hard sets/week).
 *
 * MUST stay in sync with the "Weekly MAV Targets" table in WORKOUT_PROTOCOL.md —
 * that table is the locked training standard and this is what the snapshot and
 * get_muscle_volume actually report against. They had drifted apart (back MAV
 * 16 here vs 14 in the doc; chest MEV 10 vs 8; core MEV 0 vs 4), so Vic was
 * chasing targets Matt's own protocol didn't set. Change both together.
 */
export const VOLUME_BANDS: Record<string, { mev: number; mav: number; mrv: number }> = {
  chest: { mev: 8, mav: 16, mrv: 20 },
  back: { mev: 10, mav: 14, mrv: 20 },
  shoulders: { mev: 8, mav: 14, mrv: 18 },
  biceps: { mev: 6, mav: 12, mrv: 16 },
  triceps: { mev: 6, mav: 12, mrv: 16 },
  legs: { mev: 6, mav: 10, mrv: 14 }, // maintenance — bank recovery for upper
  core: { mev: 4, mav: 8, mrv: 12 },
};
