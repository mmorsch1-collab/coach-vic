import { bridge } from '../bridge/client.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { todayStr } from '../util/time.js';
import { e1rm } from './metrics.js';
import { invalidateSnapshot } from './snapshot.js';

/**
 * Ingest path: read Matt's FILLED-IN Workout_<date> sheet and import only his
 * ACTUAL completed sets into WORKOUT_DATABASE (deduped, idempotent).
 *
 * The template separates plan from actuals: the `Target` column holds the plan
 * (read-only guidance), while `Weight`/`Reps` start BLANK for Matt to fill. We
 * import a row ONLY when both Weight and Reps are filled — so a plan can never
 * pose as a completed set. WORKOUT_DATABASE volume/e1RM stay grounded in reality.
 *
 * WORKOUT_DATABASE column order (matches log_set/log_workout in llm/tools.ts):
 *   [date, session, exercise, weight, set1, set2, set3, notes, rir, e1rm]
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

export async function ingestWorkout(
  date?: string,
): Promise<{ added: number; skipped: number; exercises: string[] }> {
  const d = date || todayStr(config.tz);

  let workout: ParsedWorkout;
  try {
    workout = (await bridge.getWorkout(d)) as ParsedWorkout;
  } catch (err) {
    logger.warn({ err, date: d }, 'ingestWorkout: no workout sheet to read');
    return { added: 0, skipped: 0, exercises: [] };
  }

  const session = workout?.title ?? '';
  const exercises = Array.isArray(workout?.exercises) ? workout.exercises : [];

  // Build one DB row per exercise that has at least one ACTUAL set.
  const candidates: Array<{ name: string; row: (string | number)[] }> = [];
  for (const ex of exercises) {
    const name = String(ex?.name ?? '').trim();
    if (!name) continue;
    const actuals = (ex.sets || []).map(actualOf).filter((a): a is { weight: number; reps: number } => a != null);
    if (actuals.length === 0) continue; // not done — skip

    // Working weight = heaviest filled set; reps = filled sets in order (up to 3).
    const workingWeight = Math.max(...actuals.map((a) => a.weight));
    const reps = actuals.map((a) => a.reps);
    const topReps = Math.max(...reps);
    const est = Math.round(e1rm(workingWeight, topReps) * 10) / 10;

    candidates.push({
      name,
      row: [
        d,
        session,
        name,
        workingWeight,
        reps[0] ?? '',
        reps[1] ?? '',
        reps[2] ?? '',
        '', // notes
        '', // rir
        est || '',
      ],
    });
  }

  if (candidates.length === 0) {
    return { added: 0, skipped: 0, exercises: [] };
  }

  // DEDUP: skip any exercise that already has a row with the same Date AND Exercise.
  const existing = new Set<string>();
  try {
    const rows = (await bridge.readSheet(DB)) as unknown[][];
    const header = (rows?.[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
    const di = header.findIndex((h) => h.includes('date'));
    const ei = header.findIndex((h) => h.includes('exercise'));
    for (let r = 1; r < (rows?.length ?? 0); r++) {
      const row = rows[r] || [];
      const rd = String(row[di >= 0 ? di : 0] ?? '').trim();
      const re = String(row[ei >= 0 ? ei : 2] ?? '').trim().toLowerCase();
      if (rd && re) existing.add(`${rd}::${re}`);
    }
  } catch (err) {
    logger.warn({ err }, 'ingestWorkout: could not read WORKOUT_DATABASE for dedup');
  }

  const toAdd = candidates.filter((c) => !existing.has(`${d}::${c.name.toLowerCase()}`));
  const skipped = candidates.length - toAdd.length;

  if (toAdd.length > 0) {
    await bridge.appendSheet(DB, toAdd.map((c) => c.row));
    invalidateSnapshot();
  }

  const exerciseNames = toAdd.map((c) => c.name);
  logger.info({ date: d, added: toAdd.length, skipped, exercises: exerciseNames }, 'ingestWorkout complete');
  return { added: toAdd.length, skipped, exercises: exerciseNames };
}
