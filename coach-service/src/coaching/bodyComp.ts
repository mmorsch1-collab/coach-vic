import { slopePerWeek } from './metrics.js';

/**
 * Body-composition data hygiene + trend maths, shared by get_bodycomp_trend,
 * the snapshot, and the Withings tools so they can never disagree.
 *
 * WHY THIS EXISTS (2026-10-16): the 2026-10-08 BODY_COMPOSITION row has a weight
 * but BLANK body-fat / muscle cells (a failed impedance reading). `Number('')`
 * is 0 — and 0 is finite — so the week-over-week averages counted it as a real
 * "0% BF, 0 lb muscle" reading. That dragged the averages down and produced a
 * false "muscle drop of ~3 lb" call. Blank, zero, and physiologically
 * implausible values are now dropped per-field before ANY maths runs.
 */

export interface BodyCompPoint {
  date: string; // YYYY-MM-DD
  weight: number | null; // lb
  bf: number | null; // body-fat %
  muscle: number | null; // lb
}

/** Plausibility bounds (per the 2026-10-16 fix request). */
export const BF_MIN = 3;
export const BF_MAX = 60;
/** Muscle mass must be at least this fraction of body weight to be believable. */
export const MUSCLE_MIN_FRACTION = 0.5;

/** Parse a sheet/API cell to a finite number, treating blank/null as MISSING (never 0). */
export function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate one reading field-by-field. A failed impedance read keeps its
 * (usually fine) weight but loses BF%/muscle; a non-positive weight voids the
 * whole reading, since muscle plausibility is judged relative to weight.
 */
export function cleanReading(raw: {
  date: string;
  weight?: unknown;
  bf?: unknown;
  muscle?: unknown;
}): BodyCompPoint {
  let weight = toNum(raw.weight);
  if (weight != null && weight <= 0) weight = null;

  let bf = toNum(raw.bf);
  if (bf != null && (bf < BF_MIN || bf > BF_MAX)) bf = null;

  let muscle = toNum(raw.muscle);
  if (muscle != null) {
    if (muscle <= 0) muscle = null;
    // Can't sanity-check muscle without a weight to compare it to.
    else if (weight == null || muscle < weight * MUSCLE_MIN_FRACTION || muscle > weight) muscle = null;
  }
  return { date: raw.date, weight, bf, muscle };
}

/** True when the reading carries a usable BF% AND muscle value (a full body-comp read). */
export function isFullBodyComp(p: BodyCompPoint): boolean {
  return p.bf != null && p.muscle != null;
}

/** Parse BODY_COMPOSITION rows (with header) into cleaned points, oldest → newest. */
export function parseBodyCompSheet(rows: unknown[][]): BodyCompPoint[] {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const header = (rows[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
  const di = header.findIndex((h) => h.includes('date'));
  const wi = header.findIndex((h) => h.includes('weight'));
  // Body-fat %, never "fat free mass" / "visceral fat": require body+fat or fat+%.
  let fi = header.findIndex((h) => h.includes('body') && h.includes('fat'));
  if (fi < 0) fi = header.findIndex((h) => h.includes('fat') && h.includes('%'));
  const mi = header.findIndex((h) => h.includes('muscle'));
  const out: BodyCompPoint[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const date = String(row[di] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const p = cleanReading({
      date,
      weight: wi >= 0 ? row[wi] : null,
      bf: fi >= 0 ? row[fi] : null,
      muscle: mi >= 0 ? row[mi] : null,
    });
    if (p.weight == null && p.bf == null && p.muscle == null) continue;
    out.push(p);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T12:00:00Z`);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function avg(xs: number[]): number | null {
  return xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

/** Points dated in the half-open window (refDate - startDaysAgo, refDate - endDaysAgo]. */
function window(points: BodyCompPoint[], refDate: string, startDaysAgo: number, endDaysAgo = 0): BodyCompPoint[] {
  const ref = t(refDate);
  return points.filter((p) => {
    const x = t(p.date);
    return x > ref - startDaysAgo * DAY && x <= ref - endDaysAgo * DAY;
  });
}

/** Goal cut rate band (GOAL.md): 0.5–0.75 lb/week of loss. */
export const TARGET_LOSS_MIN = 0.5;
export const TARGET_LOSS_MAX = 0.75;

export type RateVerdict = 'insufficient_data' | 'gaining' | 'slow' | 'on_target' | 'too_fast' | 'mixed';

export interface WeightTrend {
  slope14: number | null; // lb/wk, regression over the last 14 days
  slope21: number | null; // lb/wk, regression over the last 21 days
  n14: number;
  n21: number;
  verdict: RateVerdict;
  /** "Too fast" fires ONLY when BOTH windows exceed the band (one high anchor can't trip it). */
  tooFast: boolean;
  note: string;
}

/**
 * Weight rate as TWO least-squares fits (14d and 21d) over every reading in each
 * window. A 21-day window alone anchored on the Sept 25–30 150–151 lb readings
 * and reported ~-1 lb/wk while the last two weeks were flat at 146–149. Requiring
 * both windows to agree before calling it "too fast" stops one stale high point
 * from driving a "you're losing too fast" message.
 */
export function weightTrend(points: BodyCompPoint[], refDate: string): WeightTrend {
  const fit = (days: number) => {
    const pts = window(points, refDate, days).filter((p) => p.weight != null);
    // Need >=4 readings spanning >=7 days for a slope to mean anything.
    const span = pts.length ? (t(pts[pts.length - 1].date) - t(pts[0].date)) / DAY : 0;
    if (pts.length < 4 || span < 7) return { slope: null as number | null, n: pts.length };
    return { slope: round(slopePerWeek(pts.map((p) => ({ date: p.date, y: p.weight as number })))), n: pts.length };
  };
  const a = fit(14);
  const b = fit(21);
  const classify = (s: number | null): RateVerdict => {
    if (s == null) return 'insufficient_data';
    const loss = -s;
    if (loss < 0) return 'gaining';
    if (loss < TARGET_LOSS_MIN) return 'slow';
    if (loss > TARGET_LOSS_MAX) return 'too_fast';
    return 'on_target';
  };
  const v14 = classify(a.slope);
  const v21 = classify(b.slope);
  const tooFast = v14 === 'too_fast' && v21 === 'too_fast';
  let verdict: RateVerdict;
  if (v14 === 'insufficient_data' && v21 === 'insufficient_data') verdict = 'insufficient_data';
  else if (v14 === 'insufficient_data') verdict = v21 === 'too_fast' ? 'mixed' : v21;
  else if (v21 === 'insufficient_data') verdict = v14 === 'too_fast' ? 'mixed' : v14;
  else verdict = v14 === v21 ? v14 : tooFast ? 'too_fast' : 'mixed';

  const band = `${TARGET_LOSS_MIN}–${TARGET_LOSS_MAX} lb/wk`;
  const fmt = (s: number | null) => (s == null ? 'n/a' : `${s >= 0 ? '+' : ''}${s.toFixed(2)} lb/wk`);
  const notes: Record<RateVerdict, string> = {
    insufficient_data: 'not enough readings for a trend',
    gaining: 'gaining — not in a deficit',
    slow: `below the ${band} target band (slow / ~maintenance)`,
    on_target: `on target (${band})`,
    too_fast: `⚠ both windows above the ${band} band — too fast, muscle risk`,
    mixed: `windows disagree (14d ${fmt(a.slope)} vs 21d ${fmt(b.slope)}) — trend is changing; do NOT call it too fast`,
  };
  return { slope14: a.slope, slope21: b.slope, n14: a.n, n21: b.n, verdict, tooFast, note: notes[verdict] };
}

export interface WeekOverWeek {
  bfThisWeek: number | null;
  bfLastWeek: number | null;
  bfDelta: number | null;
  muscleThisWeek: number | null;
  muscleLastWeek: number | null;
  muscleDelta: number | null;
  nThisWeek: number;
  nLastWeek: number;
}

/** This-7-days vs prior-7-days averages over VALID readings only. */
export function weekOverWeek(points: BodyCompPoint[], refDate: string): WeekOverWeek {
  const thisWk = window(points, refDate, 7);
  const lastWk = window(points, refDate, 14, 7);
  const pick = (ps: BodyCompPoint[], k: 'bf' | 'muscle') =>
    ps.map((p) => p[k]).filter((x): x is number => x != null);
  const bfThisWeek = avg(pick(thisWk, 'bf'));
  const bfLastWeek = avg(pick(lastWk, 'bf'));
  const muscleThisWeek = avg(pick(thisWk, 'muscle'));
  const muscleLastWeek = avg(pick(lastWk, 'muscle'));
  const d = (x: number | null, y: number | null) => (x != null && y != null ? round(x - y) : null);
  return {
    bfThisWeek,
    bfLastWeek,
    bfDelta: d(bfThisWeek, bfLastWeek),
    muscleThisWeek,
    muscleLastWeek,
    muscleDelta: d(muscleThisWeek, muscleLastWeek),
    nThisWeek: thisWk.filter(isFullBodyComp).length,
    nLastWeek: lastWk.filter(isFullBodyComp).length,
  };
}

/** Muscle-mass regression slope over the last 14 days of VALID readings (null if <3). */
export function muscleSlope14(points: BodyCompPoint[], refDate: string): { slope: number | null; n: number } {
  const pts = window(points, refDate, 14).filter((p) => p.muscle != null);
  if (pts.length < 3) return { slope: null, n: pts.length };
  return { slope: round(slopePerWeek(pts.map((p) => ({ date: p.date, y: p.muscle as number })))), n: pts.length };
}

/**
 * Validate a flat Withings summary (bridge /withings/summary). Implausible
 * BF%/muscle are nulled and flagged, so the coach never reads a failed
 * measurement as a real one.
 */
export function cleanWithingsSummary<T extends Record<string, any>>(s: T): T & { dataQuality?: string } {
  if (!s || typeof s !== 'object') return s;
  const date = String(s.measuredAt ?? '').slice(0, 10) || '0000-00-00';
  const c = cleanReading({ date, weight: s.weightLbs, bf: s.bodyFatPercent, muscle: s.muscleMassLbs });
  const dropped: string[] = [];
  if (s.bodyFatPercent != null && c.bf == null) dropped.push('bodyFatPercent');
  if (s.muscleMassLbs != null && c.muscle == null) dropped.push('muscleMassLbs');
  if (s.weightLbs != null && c.weight == null) dropped.push('weightLbs');
  const out: any = { ...s, weightLbs: c.weight, bodyFatPercent: c.bf, muscleMassLbs: c.muscle };
  if (c.muscle == null) out.muscleMassPercent = null;
  if (dropped.length) {
    out.dataQuality =
      `Implausible/failed reading dropped for: ${dropped.join(', ')}. Treat as MISSING — ` +
      `do not report or average it.`;
  }
  return out;
}

/** Filter Withings weight-history entries to plausible weights only. */
export function cleanWeightHistory(hist: unknown): unknown {
  if (!Array.isArray(hist)) return hist;
  return hist.filter((h: any) => {
    const lbs = toNum(h?.weight?.lbs);
    return lbs != null && lbs > 0;
  });
}
