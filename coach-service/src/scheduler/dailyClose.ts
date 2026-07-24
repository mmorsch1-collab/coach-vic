import { config } from '../config.js';
import { logger } from '../logger.js';
import { todayStr, yesterdayStr } from '../util/time.js';
import { bridge } from '../bridge/client.js';
import { ingestWorkout } from '../coaching/workoutIngest.js';
import { parseWorkoutDb, unclassifiedExercises, daysSince } from '../coaching/metrics.js';
import { todayProteinTotal } from '../coaching/nutrition.js';
import { readDayUsage } from '../llm/usage.js';

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

  // Ingest actuals — today AND yesterday (deduped/idempotent): a sheet filled in
  // after 23:59 would otherwise never be ingested and the session would vanish
  // from WORKOUT_DATABASE.
  const res = await ingestWorkout(date);
  logger.info({ date, ...res }, 'daily-close: ingest summary');
  try {
    const yres = await ingestWorkout(yesterdayStr(config.tz));
    if (yres.added > 0) logger.info({ ...yres }, 'daily-close: late-filled yesterday ingested');
  } catch (err) {
    logger.warn({ err }, 'daily-close: yesterday ingest failed (non-fatal)');
  }

  // Gap: workout tab present but nothing filled in and nothing already logged.
  if (hasWorkoutTab && res.added === 0 && res.skipped === 0) {
    logger.warn({ date }, 'daily-close GAP: workout sheet not filled (Workout tab exists, zero actual sets)');
  }

  // Gap: novel exercises the classifier can't place (their volume is uncounted
  // until Vic asks Matt and calls classify_exercise). Deterministic visibility;
  // the snapshot surfaces the same list to the coach for action.
  try {
    const dbLogs = parseWorkoutDb((await bridge.readSheet('WORKOUT_DATABASE')) as unknown[][]);
    const recent = dbLogs.filter((l) => daysSince(l.date) <= 21);
    const unknown = unclassifiedExercises(recent);
    if (unknown.length) {
      logger.warn({ date, unknown }, 'daily-close GAP: unclassified exercises (volume uncounted until classified)');
    }
  } catch (err) {
    logger.warn({ err, date }, 'daily-close: could not check unclassified exercises');
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

  // Cache health: a day of writes with ZERO reads means a silent prompt-cache
  // invalidator crept in — we'd be paying the write premium for nothing.
  try {
    const u = await readDayUsage(date);
    if (u && u.cacheWrite > 0 && u.cacheRead === 0) {
      logger.warn(
        { date, cacheWrite: u.cacheWrite },
        'daily-close CACHE: cache written all day but never read — check for a prefix invalidator',
      );
    }
  } catch (err) {
    logger.warn({ err, date }, 'daily-close: could not check cache usage');
  }
}
