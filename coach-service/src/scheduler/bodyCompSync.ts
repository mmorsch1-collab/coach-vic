import { bridge } from '../bridge/client.js';
import { config } from '../config.js';
import { todayStr } from '../util/time.js';
import { invalidateSnapshot } from '../coaching/snapshot.js';
import { logger } from '../logger.js';

/**
 * Sync Withings readings into the BODY_COMPOSITION sheet so the coach's body-comp
 * trends / cut-rate management run on LIVE data. Replaces OpenClaw's "6 AM Withings"
 * job. Idempotent (dedupes by date) and self-healing: each run also backfills the
 * recent window so any missed days fill in. Silent (no message).
 *
 *  - weight for each recent day (from weight-history)
 *  - body fat % + muscle for the latest reading (from the summary)
 */
const round = (v: any, d = 1) =>
  Number.isFinite(Number(v)) ? Math.round(Number(v) * 10 ** d) / 10 ** d : '';

export async function syncBodyComp(backfillDays = 10): Promise<{ synced: number; reason?: string }> {
  // Existing dates already in the sheet (column A).
  let have = new Set<string>();
  try {
    const rows = (await bridge.readSheet('BODY_COMPOSITION', 'A1:A400')) as unknown[][];
    have = new Set(rows.map((r) => String((r || [])[0] ?? '').trim()).filter(Boolean));
  } catch {
    /* proceed; worst case we append a dup, but reads rarely fail */
  }

  const toAppend: unknown[][] = [];

  // FULLER ROW FIRST: the latest reading WITH body composition (summary). This
  // must run before the weight-only backfill — otherwise the weight-history loop
  // claims the same date with a BF-less row and starves the snapshot's body-fat
  // trend (the #1 stop-cutting signal) for days.
  try {
    const s = (await bridge.withingsSummary()) as Record<string, any>;
    if (s?.weightLbs != null) {
      const dt = todayStr(config.tz, s.measuredAt ? new Date(s.measuredAt) : new Date());
      if (!have.has(dt)) {
        toAppend.push([
          dt,
          round(s.weightLbs, 1),
          round(s.bodyFatPercent, 1),
          round(s.muscleMassLbs, 1),
          round(s.hydrationPercent, 1),
          round(s.visceralFatRating, 0),
          'auto-sync (Withings)',
        ]);
        have.add(dt);
      }
    }
  } catch (err) {
    logger.warn({ err }, 'BodyComp sync: summary fetch failed');
  }

  // Weight per recent day (weight-history) — backfill for any remaining days.
  try {
    const hist = (await bridge.withingsHistory(backfillDays)) as Array<{ date: string; weight: { lbs: number } }>;
    for (const h of hist || []) {
      const dt = todayStr(config.tz, new Date(h.date));
      if (!have.has(dt) && h.weight?.lbs != null) {
        toAppend.push([dt, round(h.weight.lbs, 1), '', '', '', '', 'auto-sync (Withings)']);
        have.add(dt);
      }
    }
  } catch (err) {
    logger.warn({ err }, 'BodyComp sync: weight-history fetch failed');
  }

  if (!toAppend.length) return { synced: 0, reason: 'nothing new to sync' };

  // Append oldest→newest for a clean chronological tail.
  toAppend.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  try {
    await bridge.appendSheet('BODY_COMPOSITION', toAppend);
    invalidateSnapshot();
    logger.info({ count: toAppend.length }, 'BodyComp sync: appended rows');
    return { synced: toAppend.length };
  } catch (err) {
    logger.warn({ err }, 'BodyComp sync: append failed');
    return { synced: 0, reason: 'append failed' };
  }
}
