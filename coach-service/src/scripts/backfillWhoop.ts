/**
 * One-off: backfill WHOOP_History from the live WHOOP API over a date range,
 * closing the gap left while the nightly logger was off. Idempotent — reads the
 * sheet first and only appends dates that are missing, so it is safe to re-run.
 *
 *   npx tsx src/scripts/backfillWhoop.ts 2026-06-29 2026-07-24
 *
 * Only SCORED rows are written (the endpoint already filters to SCORED). Strain
 * is the real full-day cycle strain, not the morning-captured value.
 */
import { bridge } from '../bridge/client.js';
import { logger } from '../logger.js';
import { invalidateSnapshot } from '../coaching/snapshot.js';

async function main() {
  const [start, end] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(end ?? '')) {
    console.error('Usage: tsx src/scripts/backfillWhoop.ts <start YYYY-MM-DD> <end YYYY-MM-DD>');
    process.exit(1);
  }

  // Existing dates in the sheet (dedup key). The bridge append does NOT dedup.
  const existingRows = (await bridge.readSheet('WHOOP_History', 'A1:A2000')) as unknown[][];
  const have = new Set(existingRows.map((r) => String((r || [])[0] ?? '').trim()).filter(Boolean));

  const rows = await bridge.whoopHistoryRange(start, end);
  const missing = rows.filter((r) => r.date && !have.has(r.date));

  console.log(`Range ${start}..${end}: ${rows.length} SCORED days from WHOOP, ${have.size} already in sheet, ${missing.length} to write.`);
  if (!missing.length) {
    console.log('Nothing to backfill.');
    return;
  }

  let written = 0;
  for (const r of missing) {
    try {
      await bridge.whoopSnapshot({
        date: r.date,
        recovery: r.recovery,
        hrv: r.hrv,
        restingHeartRate: r.restingHeartRate,
        sleepHours: r.sleepHours,
        sleepScore: r.sleepScore,
        strain: r.strain,
        skinTemp: r.skinTemp,
      });
      written++;
      console.log(`  + ${r.date}  rec ${r.recovery}  hrv ${r.hrv}  strain ${r.strain}`);
    } catch (err) {
      logger.warn({ err, date: r.date }, 'backfill: write failed');
      console.error(`  ! ${r.date} failed: ${(err as Error).message}`);
    }
  }

  if (written) invalidateSnapshot();
  console.log(`Backfill complete: ${written}/${missing.length} rows written.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
