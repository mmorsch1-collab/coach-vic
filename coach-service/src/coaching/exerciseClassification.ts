import { JsonStore } from '../state/jsonStore.js';
import { logger } from '../logger.js';
import { setMuscleOverrides, KNOWN_MUSCLES } from './metrics.js';
import { invalidateSnapshot } from './snapshot.js';

/**
 * Durable store for user-taught exercise → muscle classifications.
 *
 * The regex classifier can't know every machine/cable variant Matt swaps in at a
 * full gym, and a novel exercise it can't place falls through to 'other' (its
 * volume silently uncounted). This lets Vic ask Matt once, record the answer, and
 * have it stick — so a misclassification never persists just because an exercise
 * is new to the database and Vic didn't bother to classify it.
 *
 * muscleOf() consults these overrides FIRST (they beat the regex), so this also
 * lets Matt correct a wrong-but-confident classification, not only fill gaps.
 */

interface ClassMap {
  /** lowercased exercise name → muscle */
  map: Record<string, string>;
}

const store = new JsonStore<ClassMap>('exercise-muscle-overrides.json', { map: {} });

/** Load overrides from disk into the in-memory classifier. Call at startup. */
export async function hydrateMuscleOverrides(): Promise<void> {
  const { map } = await store.read();
  setMuscleOverrides(map);
  logger.info({ count: Object.keys(map).length }, 'Exercise classifications hydrated');
}

/**
 * Record (or correct) the muscle for an exercise. Idempotent. Re-hydrates the
 * classifier and invalidates the snapshot so the new volume count takes effect
 * immediately. Returns the normalized muscle, or null if the muscle is invalid.
 */
export async function classifyExercise(exercise: string, muscle: string): Promise<string | null> {
  const name = String(exercise ?? '').trim();
  const m = String(muscle ?? '').trim().toLowerCase();
  if (!name) return null;
  if (!(KNOWN_MUSCLES as readonly string[]).includes(m)) return null;

  await store.update((s) => {
    s.map[name.toLowerCase()] = m;
  });
  const { map } = await store.read();
  setMuscleOverrides(map);
  invalidateSnapshot();
  logger.info({ exercise: name, muscle: m }, 'Exercise classified (user-taught)');
  return m;
}

/** Current taught classifications (for display/debug). */
export async function listClassifications(): Promise<Record<string, string>> {
  return (await store.read()).map;
}
