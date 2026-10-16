import { JsonStore } from '../state/jsonStore.js';

/**
 * The PLAN each Workout_<date> sheet was built from, so a filled sheet can be
 * checked against it.
 *
 * WHY (2026-10-16): checkbox sheets PREFILL Weight/Reps with the targets, so the
 * sheet alone can't say whether a number was edited. Two silent failure modes:
 *  - Matt edits a set's weight/reps but forgets to tick Done → the set is NOT
 *    ingested (unchecked = skipped) and his real work vanishes from volume.
 *  - A ticked set differs from the plan → usually a real deviation (drop set,
 *    heavier attempt), occasionally a typo; either way worth confirming.
 * Stored at create_workout time; kept for 60 days.
 */

export interface PlannedSet {
  weight: number | 'BW' | null; // null = no target (baseline lift)
  reps: number | null;
}
interface PlanState {
  byDate: Record<string, Record<string, PlannedSet[]>>; // date → exercise(lowercase) → sets
}
const store = new JsonStore<PlanState>('workout-plans.json', { byDate: {} });
const KEEP_DAYS = 60;

export function planFromExercises(
  exercises: Array<{ name?: string; sets?: number; targetReps?: number; targetWeight?: string }>,
): Record<string, PlannedSet[]> {
  const out: Record<string, PlannedSet[]> = {};
  for (const e of exercises ?? []) {
    const name = String(e?.name ?? '').trim().toLowerCase();
    const n = Math.max(0, Math.min(20, Math.round(Number(e?.sets) || 0)));
    if (!name || !n) continue;
    const tw = String(e?.targetWeight ?? '').trim();
    const num = Number(tw.replace(/[^0-9.]/g, ''));
    const weight: PlannedSet['weight'] = !tw ? null : /^bw$/i.test(tw) ? 'BW' : Number.isFinite(num) && num > 0 ? num : null;
    const reps = Number.isFinite(Number(e?.targetReps)) && Number(e?.targetReps) > 0 ? Number(e?.targetReps) : null;
    out[name] = Array.from({ length: n }, () => ({ weight, reps }));
  }
  return out;
}

export async function savePlan(date: string, plan: Record<string, PlannedSet[]>): Promise<void> {
  await store.update((s) => {
    s.byDate[date] = plan;
    const keys = Object.keys(s.byDate).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete s.byDate[k];
  });
}

export async function getPlan(date: string): Promise<Record<string, PlannedSet[]> | null> {
  return (await store.read()).byDate[date] ?? null;
}

interface SheetSet {
  set: number;
  weight: string;
  reps: string;
  done: string;
}
interface SheetExercise {
  name: string;
  sets: SheetSet[];
}

const num = (v: unknown): number | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^bw$/i.test(s)) return 0;
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const plannedWeight = (w: PlannedSet['weight']): number | null => (w === 'BW' ? 0 : w);

/**
 * Compare a checkbox sheet with its plan. Returns human-readable warnings:
 *  - FILLED BUT NOT CHECKED: an unticked row whose numbers were changed from the
 *    plan (or filled where the plan had none) — likely done but not ticked.
 *  - CHECKED BUT DIFFERS: a ticked row whose weight/reps differ from the plan.
 */
export function checkSheetAgainstPlan(
  exercises: SheetExercise[],
  plan: Record<string, PlannedSet[]> | null,
  isDone: (v: unknown) => boolean,
): string[] {
  if (!plan) return [];
  const notChecked: string[] = [];
  const differs: string[] = [];
  for (const ex of exercises ?? []) {
    const planned = plan[String(ex?.name ?? '').trim().toLowerCase()];
    if (!planned) continue; // swapped-in exercise: no plan to compare against
    for (const s of ex.sets ?? []) {
      const p = planned[(s.set || 0) - 1];
      if (!p) continue;
      const w = num(s.weight);
      const r = num(s.reps);
      const pw = plannedWeight(p.weight);
      const weightChanged = w !== pw && !(w == null && pw == null);
      const repsChanged = r !== p.reps && !(r == null && p.reps == null);
      if (!weightChanged && !repsChanged) continue;
      const shown = `${s.weight || '—'}×${s.reps || '—'}`;
      const plannedTxt = `${p.weight ?? '—'}×${p.reps ?? '—'}`;
      if (isDone(s.done)) differs.push(`${ex.name} set ${s.set}: ${shown} vs plan ${plannedTxt}`);
      else if (w != null || r != null) notChecked.push(`${ex.name} set ${s.set}: ${shown} (plan ${plannedTxt})`);
    }
  }
  const out: string[] = [];
  if (notChecked.length) {
    out.push(
      `FILLED BUT NOT CHECKED (${notChecked.length}) — numbers were edited but Done isn't ticked, so these ` +
        `sets are NOT counted: ${notChecked.join('; ')}. Ask Matt whether he did them.`,
    );
  }
  if (differs.length) {
    out.push(`CHECKED BUT DIFFERS FROM PLAN (${differs.length}): ${differs.join('; ')}. Logged as performed; confirm if any is a typo.`);
  }
  return out;
}
