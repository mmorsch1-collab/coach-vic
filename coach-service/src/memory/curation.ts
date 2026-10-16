import { runTurn } from '../llm/agent.js';
import { readDailyLog, listDailyLogDates } from './store.js';
import { JsonStore } from '../state/jsonStore.js';
import { todayStr, yesterdayStr, addDaysStr } from '../util/time.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Scheduled memory maintenance (the "memory maintenance during heartbeats" loop):
 * review the daily logs and distill durable items into the RAG databases /
 * MEMORY.md via tools. Runs ISOLATED: it is a scheduled job, so it neither
 * loads nor writes MEMORY.md (main-chat only, 2026-10-16).
 *
 * Catch-up semantics: a persisted cursor tracks the last successfully curated
 * COMPLETED day. Each run curates every un-curated day up to yesterday (capped),
 * advancing the cursor per-day only on success — so a missed 3:30 AM run (PM2
 * down, API error) no longer silently loses that day from durable memory.
 */

const CATCHUP_CAP_DAYS = 7; // bound token spend after a long outage

const state = new JsonStore<{ lastCuratedDay: string }>('curation-state.json', {
  lastCuratedDay: '',
});

async function curateDay(date: string): Promise<void> {
  const log = await readDailyLog(date);
  if (!log.trim()) {
    logger.info({ date }, 'Curation: empty daily log, skipping');
    return;
  }

  const instruction = [
    `Daily memory maintenance for ${date}. Below is that day's raw daily log.`,
    `Distill anything DURABLE and worth keeping long-term:`,
    `- new stable preferences → remember() into PREFERENCES_PROFILE_DATABASE.md`,
    `- interventions that clearly worked/failed → COACHING_INSIGHTS_DATABASE.md`,
    `- new lasting context about Matt → CONTEXTUAL_MEMORY_DATABASE.md`,
    `- measurable trends → PERFORMANCE_PATTERNS_DATABASE.md`,
    `Be conservative: skip transient noise and anything already in the databases.`,
    `Do NOT message Matt. When done, reply "done".`,
    ``,
    `DAILY LOG ${date}:\n${log}`,
  ].join('\n');

  await runTurn({
    messages: [{ role: 'user', content: instruction }],
    // Isolated: MEMORY.md is main-chat only, and a log that quotes tool output must
    // not be able to edit rules or long-term memory from a scheduled job.
    sessionType: 'isolated',
    tier: 'primary',
    maxTokens: 600,
    maxIterations: 8,
    // The full raw log is embedded above — don't also inject the recent-log block.
    includeRecentLogs: false,
  });
}

export async function runDailyCuration(): Promise<void> {
  const yesterday = yesterdayStr(config.tz);
  const today = todayStr(config.tz);
  const st = await state.read();

  // Un-curated completed days: from the cursor (exclusive) through yesterday.
  // First run (no cursor): start at yesterday only — no surprise backfill.
  let from = st.lastCuratedDay ? addDaysStr(st.lastCuratedDay, 1) : yesterday;
  const capFloor = addDaysStr(today, -CATCHUP_CAP_DAYS);
  if (from < capFloor) {
    logger.warn({ from, capFloor }, 'Curation: capping catch-up window');
    from = capFloor;
  }

  const onDisk = new Set(await listDailyLogDates());
  for (let d = from; d <= yesterday; d = addDaysStr(d, 1)) {
    try {
      if (onDisk.has(d)) await curateDay(d);
      await state.update((s) => {
        s.lastCuratedDay = d;
      });
      logger.info({ date: d }, 'Daily curation complete');
    } catch (err) {
      // Stop here — the cursor stays on the last SUCCESSFUL day so this day is
      // retried on the next run instead of being lost.
      logger.warn({ err, date: d }, 'Daily curation failed; will retry next run');
      return;
    }
  }
}
