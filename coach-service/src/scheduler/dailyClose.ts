import { config } from '../config.js';
import { logger } from '../logger.js';
import { todayStr } from '../util/time.js';
import { bridge } from '../bridge/client.js';
import { ingestWorkout } from '../coaching/workoutIngest.js';
import { todayProteinTotal } from '../coaching/nutrition.js';

/**
 * Deterministic daily "close" — NO LLM, NO Telegram. Runs after dinner to:
 *  1. Ingest today's ACTUAL completed sets from the filled Workout_<date> sheet
 *     into WORKOUT_DATABASE (deduped/idempotent).
 *  2. Log a summary (added/skipped) and flag data gaps so they surface in logs:
 *       - a Workout_<date> tab exists but zero filled sets ("sheet not filled"),
 *       - a workout was logged today but no nutrition rows exist.
 * It only updates data + logs; it never sends a message.
 */
export async function runDailyClose(): Promise<void> {
  const date = todayStr(config.tz);

  // Does a workout tab exist for today?
  let hasWorkoutTab = false;
  try {
    const tabs = await bridge.listSheets();
    hasWorkoutTab = tabs.some((t) => t.title === `Workout_${date}`);
  } catch (err) {
    logger.warn({ err, date }, 'daily-close: could not list sheets');
  }

  // Ingest actuals.
  const res = await ingestWorkout(date);
  logger.info({ date, ...res }, 'daily-close: ingest summary');

  // Gap: workout tab present but nothing filled in and nothing already logged.
  if (hasWorkoutTab && res.added === 0 && res.skipped === 0) {
    logger.warn({ date }, 'daily-close GAP: workout sheet not filled (Workout tab exists, zero actual sets)');
  }

  // Gap: a workout was logged/ingested today but no nutrition rows.
  if (res.added > 0 || res.skipped > 0) {
    try {
      const protein = await todayProteinTotal();
      if (protein.meals === 0) {
        logger.warn({ date }, 'daily-close GAP: workout logged but no nutrition rows today');
      }
    } catch (err) {
      logger.warn({ err, date }, 'daily-close: could not check nutrition');
    }
  }
}
