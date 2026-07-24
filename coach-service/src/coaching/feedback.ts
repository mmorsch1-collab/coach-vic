import { JsonStore } from '../state/jsonStore.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { todayStr, daysBetween } from '../util/time.js';

/**
 * Structured post-workout feedback — the subjective signals a coach actually
 * programs around, captured so each one drives a specific decision instead of
 * evaporating into a freeform note (which is where they went before: RIR was
 * filled 1% of the time and read by nothing; pain/mind-muscle had no home).
 *
 * Each field maps to an action, and NOTHING is captured that isn't used:
 *   - rir (key lift, last set) → gates load progression
 *   - mmc  (mind-muscle connection) → exercise SELECTION. Crucially we capture
 *     WEAK/NONE too, not just "what felt best": an exercise that gives Matt no
 *     connection over 2+ sessions is a replacement candidate.
 *   - pain (area + severity) → substitution + load backoff, esp. back/hip.
 *
 * This store is the source of truth for these signals. The WORKOUT_DATABASE RIR
 * column stays for manual/legacy entry but proved unreliable, so coaching reads
 * from here.
 */

export type MMC = 'strong' | 'moderate' | 'weak' | 'none';
export type PainSeverity = 'mild' | 'moderate' | 'sharp';
export const MMC_VALUES: MMC[] = ['strong', 'moderate', 'weak', 'none'];
export const PAIN_SEVERITIES: PainSeverity[] = ['mild', 'moderate', 'sharp'];

export interface FeedbackEntry {
  date: string; // YYYY-MM-DD
  exercise: string;
  rir?: number | null;
  mmc?: MMC | null;
  painArea?: string | null; // e.g. "lower back", "left hip", "left knee"
  painSeverity?: PainSeverity | null;
  note?: string | null;
}

interface FeedbackState {
  entries: FeedbackEntry[];
}

const store = new JsonStore<FeedbackState>('workout-feedback.json', { entries: [] });

/** Record one exercise's feedback. Upserts on (date, exercise) so re-answering
 *  corrects rather than duplicates. */
export async function logFeedback(fb: FeedbackEntry): Promise<FeedbackEntry | null> {
  const exercise = String(fb.exercise ?? '').trim();
  if (!exercise) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(fb.date)) ? fb.date : todayStr(config.tz);
  const entry: FeedbackEntry = {
    date,
    exercise,
    rir: fb.rir ?? null,
    mmc: fb.mmc ?? null,
    painArea: fb.painArea ? String(fb.painArea).trim().toLowerCase() : null,
    painSeverity: fb.painSeverity ?? null,
    note: fb.note ? String(fb.note).trim() : null,
  };
  await store.update((s) => {
    const i = s.entries.findIndex(
      (e) => e.date === date && e.exercise.toLowerCase() === exercise.toLowerCase(),
    );
    // Merge, so a second call that only adds MMC doesn't wipe an earlier RIR.
    if (i >= 0) s.entries[i] = { ...s.entries[i], ...pruneNulls(entry) };
    else s.entries.push(entry);
  });
  logger.info({ ...entry }, 'workout feedback logged');
  return entry;
}

/** Drop null/undefined so a merge only overwrites fields that were actually given. */
function pruneNulls(e: FeedbackEntry): Partial<FeedbackEntry> {
  const out: Partial<FeedbackEntry> = { date: e.date, exercise: e.exercise };
  if (e.rir != null) out.rir = e.rir;
  if (e.mmc != null) out.mmc = e.mmc;
  if (e.painArea != null) out.painArea = e.painArea;
  if (e.painSeverity != null) out.painSeverity = e.painSeverity;
  if (e.note != null) out.note = e.note;
  return out;
}

export async function allFeedback(): Promise<FeedbackEntry[]> {
  return (await store.read()).entries;
}

/**
 * Per-exercise mind-muscle summary over the window. An exercise with 2+
 * weak/none ratings is a REPLACEMENT CANDIDATE — the whole point of capturing
 * poor connection, not just good. Strong-connection exercises are worth keeping.
 */
export interface MmcSummary {
  exercise: string;
  latest: MMC;
  weakOrNone: number;
  strong: number;
  count: number;
  replaceCandidate: boolean;
}
export function summarizeMmc(entries: FeedbackEntry[], days = 42, refDate = todayStr(config.tz)): MmcSummary[] {
  const byEx = new Map<string, FeedbackEntry[]>();
  for (const e of entries) {
    if (e.mmc == null) continue;
    if (daysBetween(e.date, refDate) > days) continue;
    const k = e.exercise;
    (byEx.get(k) ?? byEx.set(k, []).get(k)!).push(e);
  }
  const out: MmcSummary[] = [];
  for (const [exercise, es] of byEx) {
    es.sort((a, b) => a.date.localeCompare(b.date));
    const weakOrNone = es.filter((e) => e.mmc === 'weak' || e.mmc === 'none').length;
    const strong = es.filter((e) => e.mmc === 'strong').length;
    out.push({
      exercise,
      latest: es[es.length - 1].mmc as MMC,
      weakOrNone,
      strong,
      count: es.length,
      replaceCandidate: weakOrNone >= 2,
    });
  }
  return out.sort((a, b) => b.weakOrNone - a.weakOrNone);
}

/** Recent pain flags, newest first — drives caution + substitution. */
export function recentPain(entries: FeedbackEntry[], days = 21, refDate = todayStr(config.tz)) {
  return entries
    .filter((e) => e.painArea && daysBetween(e.date, refDate) <= days)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => ({ date: e.date, exercise: e.exercise, area: e.painArea!, severity: e.painSeverity ?? 'mild' }));
}

/** Most recent RIR per exercise within the window (for progression readiness). */
export function lastRirByExercise(entries: FeedbackEntry[], days = 21, refDate = todayStr(config.tz)): Record<string, { rir: number; date: string }> {
  const out: Record<string, { rir: number; date: string }> = {};
  for (const e of entries) {
    if (e.rir == null || daysBetween(e.date, refDate) > days) continue;
    const k = e.exercise;
    if (!out[k] || e.date > out[k].date) out[k] = { rir: e.rir, date: e.date };
  }
  return out;
}
