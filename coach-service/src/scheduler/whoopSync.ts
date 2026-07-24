import { bridge, type WhoopToday } from '../bridge/client.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { todayStr } from '../util/time.js';
import { invalidateSnapshot } from '../coaching/snapshot.js';

/**
 * Standalone WHOOP_History logger.
 *
 * WHOOP_History is what feeds every MULTI-DAY signal — the recovery trend, the
 * HRV drop-streak, the workout-day strain pattern. It used to be written only
 * as a step of the morning ritual, so when the ritual was disabled the sheet
 * silently stopped growing (last row 2026-06-29) while today's live recovery
 * kept working fine. Decoupling it means the trend signals no longer depend on
 * whether Vic is auto-building workout sheets.
 *
 * Runs LATE (23:30) on purpose. WHOOP scores recovery once after waking and it
 * holds for the day, so a late capture still gets today's recovery/HRV/RHR/
 * sleep — but it ALSO gets strain after a full day of accumulation. The old
 * morning capture recorded strain-so-far-at-wake (real logged values: 0.07,
 * 0.09, 1.46 on genuine training days), which made the strain signal useless.
 * Capturing at 23:30 is what makes workout-day strain meaningful, at no extra
 * cost over a morning run.
 */

const SHEET = 'WHOOP_History';

/** The bridge appends blindly (no dedupe) — that is why 2026-06-09 appears 4x. */
async function alreadyLogged(date: string): Promise<boolean> {
  try {
    const rows = (await bridge.readSheet(SHEET, 'A1:A2000')) as unknown[][];
    return rows.some((r) => String((r || [])[0] ?? '').trim() === date);
  } catch (err) {
    // If we cannot verify, do NOT write — a duplicate row is worse than a gap,
    // because the trend maths treats each row as a distinct observation.
    logger.warn({ err }, 'WHOOP sync: could not read history to dedupe; skipping write');
    return true;
  }
}

/** WHOOP's token refresh 502s intermittently; a couple of retries clears it. */
async function fetchWhoopWithRetry(attempts = 3): Promise<WhoopToday | null> {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await bridge.whoopToday();
    } catch (err) {
      logger.warn({ err, attempt: i }, 'WHOOP sync: fetch failed');
      if (i < attempts) await new Promise((r) => setTimeout(r, 20_000));
    }
  }
  return null;
}

export async function syncWhoopSnapshot(): Promise<{ written: boolean; reason?: string }> {
  const date = todayStr(config.tz);

  if (await alreadyLogged(date)) {
    return { written: false, reason: 'already logged' };
  }

  const data = await fetchWhoopWithRetry();
  if (!data) return { written: false, reason: 'whoop unreachable' };

  // Only SCORED rows go in. An unscored/pending row would land in the sheet as
  // a real observation and quietly drag every average that reads it.
  const state = data.recovery?.metadata?.score_state;
  if (state !== 'SCORED') {
    logger.info({ state }, 'WHOOP sync: not SCORED, skipping');
    return { written: false, reason: `not SCORED (${state ?? 'missing'})` };
  }

  try {
    await bridge.whoopSnapshot({
      date,
      recovery: data.recovery?.score ?? null,
      hrv: data.recovery?.hrv ?? null,
      restingHeartRate: data.recovery?.restingHeartRate ?? null,
      sleepHours: data.sleep?.durationHours ?? null,
      sleepScore: data.sleep?.sleepScore ?? null,
      strain: data.strain?.score ?? null,
      skinTemp: data.recovery?.skinTemp ?? null,
    });
    invalidateSnapshot();
    logger.info(
      { date, recovery: data.recovery?.score, strain: data.strain?.score },
      'WHOOP sync: history row written',
    );
    return { written: true };
  } catch (err) {
    logger.warn({ err }, 'WHOOP sync: append failed');
    return { written: false, reason: 'append failed' };
  }
}
