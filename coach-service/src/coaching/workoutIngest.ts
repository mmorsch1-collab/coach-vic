import { bridge } from '../bridge/client.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { todayStr } from '../util/time.js';
import { e1rm, parseWorkoutDb, bestE1rmBefore, topSet, formatSetDetail, type SetEntry } from './metrics.js';
import { checkSheetAgainstPlan, getPlan } from './workoutPlan.js';
import { JsonStore } from '../state/jsonStore.js';
import { invalidateSnapshot } from './snapshot.js';
import { appendDailyLog } from '../memory/store.js';

/**
 * Ingest path: read Matt's Workout_<date> sheet and import only his ACTUAL
 * completed sets into WORKOUT_DATABASE (deduped, idempotent).
 *
 * Two sheet generations, auto-detected per sheet:
 *  - CHECKBOX sheets (current): Weight/Reps come PREFILLED with the plan's
 *    targets and each set has a Done checkbox. Checked = he executed that set
 *    (numbers as shown — he edits them only on deviation). Unchecked = skipped.
 *    Detection: any set carries a done value ("TRUE"/"FALSE").
 *  - LEGACY sheets: Weight/Reps start blank; a set counts ONLY when both are
 *    filled (a plan can never pose as a completed set).
 *
 * WORKOUT_DATABASE column order (matches log_set/log_workout in llm/tools.ts):
 *   [date, session, exercise, weight, set1, set2, set3, notes, rir, e1rm, set4, set5, set6, set_detail]
 * weight = TOP set (best per-set e1RM); set1..6 = reps of the first six sets in
 * order; set_detail = EVERY set as "185x6; 175x8; 165x10" (authoritative).
 */

const DB = 'WORKOUT_DATABASE';

interface ParsedSet {
  set: number;
  target: string;
  lastTime: string;
  weight: string;
  reps: string;
  done: string;
}
interface ParsedExercise {
  name: string;
  sets: ParsedSet[];
}
interface ParsedWorkout {
  title: string;
  dateInfo: string;
  exercises: ParsedExercise[];
}

/** A filled actual set: both weight and reps are present and numeric. */
function actualOf(s: ParsedSet): { weight: number; reps: number } | null {
  const w = Number(String(s.weight ?? '').replace(/[^0-9.]/g, ''));
  const r = Number(String(s.reps ?? '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(w) || w <= 0) return null;
  if (!Number.isFinite(r) || r <= 0) return null;
  return { weight: w, reps: r };
}

/** Checked-checkbox variants ("TRUE" from a real checkbox; x/✓/yes from hand edits). */
export function doneTruthy(v: unknown): boolean {
  return /^(true|x|✓|yes|done|1)$/i.test(String(v ?? '').trim());
}

/** Checkbox-generation sheet: any set carries a done value (TRUE or FALSE). */
function hasCheckboxes(exercises: ParsedExercise[]): boolean {
  return exercises.some((ex) => (ex.sets || []).some((s) => String(s?.done ?? '').trim() !== ''));
}

/** Completed sets per the sheet's contract (see module doc). */
function completedSetsOf(
  ex: ParsedExercise,
  checkboxMode: boolean,
): Array<{ weight: number; reps: number }> {
  const sets = ex.sets || [];
  if (!checkboxMode) {
    return sets.map(actualOf).filter((a): a is { weight: number; reps: number } => a != null);
  }
  const out: Array<{ weight: number; reps: number }> = [];
  for (const s of sets) {
    if (!doneTruthy(s.done)) continue;
    const w = Number(String(s.weight ?? '').replace(/[^0-9.]/g, ''));
    const r = Number(String(s.reps ?? '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(r) || r <= 0) continue; // reps are required to mean anything
    out.push({ weight: Number.isFinite(w) && w > 0 ? w : 0, reps: r }); // 0 = bodyweight/unset
  }
  return out;
}

/**
 * Annotate a parsed workout for the model: strip the raw `done` field and emit a
 * per-set `completed` boolean under the correct (auto-detected) contract.
 */
export function annotateCompletion(w: any): any {
  if (!w || !Array.isArray(w.exercises)) return w;
  const checkbox = hasCheckboxes(w.exercises);
  for (const ex of w.exercises) {
    if (!Array.isArray(ex?.sets)) continue;
    ex.sets = ex.sets.map(({ done, ...s }: any) => ({
      ...s,
      completed: checkbox ? doneTruthy(done) : actualOf({ ...s, done: '' }) != null,
    }));
  }
  return w;
}

/**
 * Cheap sheet check for the missed-workout nudge: does today's sheet exist, and
 * has Matt filled anything in? (Filled Weight+Reps = he trained — he never says
 * so explicitly and never marks "done", so ALWAYS check before nudging.)
 */
export async function workoutSheetStatus(
  date: string,
): Promise<{ exists: boolean; title: string; filledSets: number; exercises: number }> {
  try {
    const w = (await bridge.getWorkout(date)) as ParsedWorkout;
    const exercises = Array.isArray(w?.exercises) ? w.exercises : [];
    const checkboxMode = hasCheckboxes(exercises);
    let filled = 0;
    for (const ex of exercises) filled += completedSetsOf(ex, checkboxMode).length;
    return { exists: true, title: w?.title ?? '', filledSets: filled, exercises: exercises.length };
  } catch {
    return { exists: false, title: '', filledSets: 0, exercises: 0 };
  }
}

export async function ingestWorkout(
  date?: string,
): Promise<{ added: number; skipped: number; exercises: string[]; prs: string[]; warnings: string[] }> {
  const d = date || todayStr(config.tz);

  let workout: ParsedWorkout;
  try {
    workout = (await bridge.getWorkout(d)) as ParsedWorkout;
  } catch (err) {
    logger.warn({ err, date: d }, 'ingestWorkout: no workout sheet to read');
    return { added: 0, skipped: 0, exercises: [], prs: [], warnings: [] };
  }

  const session = workout?.title ?? '';
  const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];

  // One DB read serves both dedup and PR detection.
  let dbRows: unknown[][] = [];
  try {
    dbRows = (await bridge.readSheet(DB)) as unknown[][];
  } catch (err) {
    logger.warn({ err }, 'ingestWorkout: could not read WORKOUT_DATABASE');
  }
  const priorLogs = parseWorkoutDb(dbRows);

  // Build one DB row per exercise that has at least one COMPLETED set
  // (Done-checked on checkbox sheets; filled Weight+Reps on legacy sheets).
  // EVERY completed set is kept with its OWN weight (drop sets, ramp-ups, mixed
  // sequences) — the old code kept only sets at the top weight and parked the
  // rest in Notes as "also: …", so they never counted as volume (2026-10-16).
  const checkboxMode = hasCheckboxes(exercises);
  const candidates: Array<{ name: string; row: (string | number)[]; pr?: string }> = [];
  for (const ex of exercises) {
    const name = String(ex?.name ?? '').trim();
    if (!name) continue;
    const actuals = completedSetsOf(ex, checkboxMode);
    if (actuals.length === 0) continue; // not done — skip

    const row = buildDbRow({ date: d, session, exercise: name, sets: actuals });
    const est = Number(row[9]) || 0;
    // PR check against all prior history (exact-name, per-set e1RM).
    const priorBest = bestE1rmBefore(priorLogs, name, d);
    const pr = priorBest > 0 && est > priorBest ? `${name}: e1RM ${est} (prev best ${priorBest})` : undefined;
    candidates.push({ name, pr, row });
  }

  // Sheet-vs-plan check (filled-but-unticked rows, ticked rows that differ).
  const warnings = checkboxMode
    ? checkSheetAgainstPlan(exercises as any, await getPlan(d).catch(() => null), doneTruthy)
    : [];
  await recordSheetWarnings(d, warnings);
  if (warnings.length) logger.warn({ date: d, warnings }, 'ingestWorkout: sheet differs from plan');

  if (candidates.length === 0) {
    return { added: 0, skipped: 0, exercises: [], prs: [], warnings };
  }
  await ensureSetDetailColumn(dbRows);

  // UPSERT (not skip): map each existing Date+Exercise row to its 1-based sheet
  // row number. Re-ingesting UPDATES that row with the latest completed sets
  // instead of skipping it. This is what makes automatic/periodic ingestion safe
  // — if an early run captures a partial session (e.g. 2 of 4 sets ticked), a
  // later run corrects the same row to the full set, so no completed set (or PR)
  // is ever lost. RIR now lives in the feedback store, not this sheet, so
  // overwriting the legacy RIR column costs nothing.
  const existingRow = new Map<string, number>();
  {
    const header = (dbRows?.[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
    const di = header.findIndex((h) => h.includes('date'));
    const ei = header.findIndex((h) => h.includes('exercise'));
    for (let r = 1; r < (dbRows?.length ?? 0); r++) {
      const row = dbRows[r] || [];
      const rd = String(row[di >= 0 ? di : 0] ?? '').trim();
      const re = String(row[ei >= 0 ? ei : 2] ?? '').trim().toLowerCase();
      if (rd && re) existingRow.set(`${rd}::${re}`, r + 1); // sheet rows are 1-based
    }
  }

  const toAppend: typeof candidates = [];
  const toUpdate: Array<{ rowNum: number; c: (typeof candidates)[number] }> = [];
  for (const c of candidates) {
    const rowNum = existingRow.get(`${d}::${c.name.toLowerCase()}`);
    if (rowNum) toUpdate.push({ rowNum, c });
    else toAppend.push(c);
  }
  // Only NEW exercises can carry a first-time PR (an update re-states an existing
  // row, so it isn't a fresh PR event).
  const prs = toAppend.map((c) => c.pr).filter((p): p is string => !!p);

  if (toAppend.length > 0) {
    await bridge.appendSheet(DB, toAppend.map((c) => c.row));
  }
  for (const { rowNum, c } of toUpdate) {
    // Column order is [A..N] = 14 columns (N = Set_Detail); update just this row.
    await bridge.updateSheetRange(DB, `A${rowNum}:N${rowNum}`, [c.row]).catch((err) =>
      logger.warn({ err, exercise: c.name, rowNum }, 'ingest: row update failed'),
    );
  }
  if (toAppend.length > 0 || toUpdate.length > 0) {
    invalidateSnapshot();
    for (const pr of prs) {
      await appendDailyLog(todayStr(config.tz), `[pr] New e1RM PR — ${pr}`).catch(() => undefined);
    }
  }

  const exerciseNames = toAppend.map((c) => c.name);
  logger.info(
    { date: d, added: toAppend.length, updated: toUpdate.length, exercises: exerciseNames, prs },
    'ingestWorkout complete',
  );
  return { added: toAppend.length, skipped: toUpdate.length, exercises: exerciseNames, prs, warnings };
}

/**
 * The single WORKOUT_DATABASE row builder (ingest, log_set, log_workout all use
 * it), so every path stores per-set weights the same way.
 */
export function buildDbRow(p: {
  date: string;
  session?: string;
  exercise: string;
  sets: SetEntry[];
  notes?: string;
  rir?: number | string | null;
}): (string | number)[] {
  const sets = p.sets.filter((s) => Number.isFinite(s.reps) && s.reps > 0);
  const top = topSet(sets);
  const est = top ? Math.round(top.e1rm * 10) / 10 : 0;
  const r = (i: number) => sets[i]?.reps ?? '';
  return [
    p.date,
    p.session ?? '',
    p.exercise,
    top ? top.set.weight || '' : '',
    r(0),
    r(1),
    r(2),
    p.notes ?? '',
    p.rir ?? '',
    est || '',
    r(3),
    r(4),
    r(5),
    formatSetDetail(sets),
  ];
}

let detailColumnEnsured = false;
/**
 * Add the Set_Detail header (column N) to WORKOUT_DATABASE once, if missing.
 * Additive: existing columns and rows are untouched; old rows without detail
 * are read through the legacy path (Weight_lbs + Set_1..6 + "also:" notes).
 */
export async function ensureSetDetailColumn(dbRows?: unknown[][]): Promise<void> {
  if (detailColumnEnsured) return;
  try {
    const header = (dbRows?.[0] ?? ((await bridge.readSheet(DB, 'A1:N1')) as unknown[][])[0] ?? []) as unknown[];
    const n = String(header[13] ?? '').trim();
    if (!n) {
      await bridge.updateSheetRange(DB, 'N1', [['Set_Detail']]);
      logger.info('WORKOUT_DATABASE: added Set_Detail header (column N)');
    } else if (n.toLowerCase() !== 'set_detail') {
      logger.warn({ header: n }, 'WORKOUT_DATABASE column N is not Set_Detail; per-set detail may be misread');
    }
    detailColumnEnsured = true;
  } catch (err) {
    logger.warn({ err }, 'Could not verify the Set_Detail column');
  }
}

const warningStore = new JsonStore<{ byDate: Record<string, string[]> }>('sheet-warnings.json', { byDate: {} });

async function recordSheetWarnings(date: string, warnings: string[]): Promise<void> {
  await warningStore
    .update((s) => {
      if (warnings.length) s.byDate[date] = warnings;
      else delete s.byDate[date];
      const keys = Object.keys(s.byDate).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 14))) delete s.byDate[k];
    })
    .catch(() => undefined);
}

/** Latest sheet-vs-plan warnings for a date (from the most recent ingest). */
export async function sheetWarnings(date: string): Promise<string[]> {
  return (await warningStore.read()).byDate[date] ?? [];
}
