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
 * a logged working set of ≥5 reps (warmups/empties excluded). */
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
