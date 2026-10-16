import { bridge } from '../bridge/client.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { todayStr, addDaysStr } from '../util/time.js';
import { invalidateSnapshot } from '../coaching/snapshot.js';

/**
 * WHOOP_History logger: feeds every MULTI-DAY signal (recovery trend, HRV
 * drop-streak, workout-day strain pattern).
 *
 * WHY THIS WAS REBUILT (2026-10-16): workout-day strain averaged ~3.4, which no
 * real training day produces. Two causes:
 *  1. The old logger wrote whatever /whoop/today returned under TODAY's date,
 *     checking only score_state. When the strap hadn't synced, it re-saved the
 *     same stale cycle day after day (WHOOP_History had 2.649 strain on Oct 9–12
 *     and 3.644 on Oct 13–15, though WHOOP only scored Oct 9 and Oct 13).
 *  2. A row written early (the morning ritual's save_whoop_snapshot, or the
 *     23:30 run on an open cycle) was never revisited, so its strain stayed at
 *     the value from when it was captured, not the day's total.
 *
 * Now: rows come from /whoop/history-range (exact recovery↔cycle↔sleep ID join,
 * one row per REAL scored date). Strain is captured as the cycle's value and
 * then OVERWRITTEN with the final total once the cycle has closed (`final` =
 * the cycle has an end, i.e. the next wake happened). Runs twice a day:
 * 23:30 (capture today, in-progress) and early afternoon (finalize the
 * previous days after they close). Idempotent; never duplicates a date.
 */

const SHEET = 'WHOOP_History';
/** Column G = Strain (Date, Recovery, HRV, Resting HR, Sleep Hours, Sleep Score, Strain, Skin Temp). */
const STRAIN_COL = 'G';

export interface ApiWhoopRow {
  date: string; // UTC date from the bridge
  createdAt?: string | null;
  recovery: number | null;
  hrv: number | null;
  restingHeartRate: number | null;
  sleepHours: number | null;
  sleepScore: number | null;
  strain: number | null;
  skinTemp: number | null;
  final?: boolean;
}

export interface SyncPlan {
  appends: Array<{ date: string; row: ApiWhoopRow }>;
  updates: Array<{ date: string; rowNum: number; from: number | null; to: number; final: boolean }>;
}

/** Local (tz) date WHOOP scored the recovery — the date the row belongs to. */
export function localDateOf(r: ApiWhoopRow, tz: string): string {
  const t = Date.parse(String(r.createdAt ?? ''));
  return Number.isFinite(t) ? todayStr(tz, new Date(t)) : r.date;
}

/**
 * Pure planner: given the sheet's rows (with header) and the API's scored rows,
 * decide what to append and which strain cells to correct.
 *  - date not in sheet → append (only SCORED, real dates: the API filters).
 *  - date in sheet, cycle FINAL → overwrite strain with the closed-day total.
 *  - date in sheet, cycle still open → only raise strain (it only accumulates).
 */
export function planWhoopSync(sheetRows: unknown[][], apiRows: ApiWhoopRow[], tz: string): SyncPlan {
  const existing = new Map<string, { rowNum: number; strain: number | null }>();
  for (let i = 1; i < (sheetRows?.length ?? 0); i++) {
    const r = sheetRows[i] || [];
    const d = String(r[0] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || existing.has(d)) continue; // first occurrence wins
    const raw = r[6];
    const n = raw === '' || raw == null ? NaN : Number(raw);
    existing.set(d, { rowNum: i + 1, strain: Number.isFinite(n) ? n : null });
  }
  const plan: SyncPlan = { appends: [], updates: [] };
  const seen = new Set<string>();
  for (const r of apiRows) {
    const date = localDateOf(r, tz);
    if (seen.has(date)) continue;
    seen.add(date);
    const ex = existing.get(date);
    if (!ex) {
      plan.appends.push({ date, row: r });
      continue;
    }
    if (r.strain == null || !Number.isFinite(r.strain)) continue;
    const diff = ex.strain == null ? Infinity : Math.abs(r.strain - ex.strain);
    if (r.final ? diff > 0.05 : ex.strain == null || r.strain > ex.strain + 0.05) {
      plan.updates.push({ date, rowNum: ex.rowNum, from: ex.strain, to: Math.round(r.strain * 100) / 100, final: !!r.final });
    }
  }
  return plan;
}

export async function syncWhoopHistory(days = 3): Promise<{ appended: number; updated: number; reason?: string }> {
  const today = todayStr(config.tz);
  // +1 day on the end: the bridge windows by UTC, and an evening-ET score is tomorrow UTC.
  const start = addDaysStr(today, -days);
  const end = addDaysStr(today, 1);

  let apiRows: ApiWhoopRow[];
  try {
    apiRows = (await bridge.whoopHistoryRange(start, end)) as ApiWhoopRow[];
  } catch (err) {
    logger.warn({ err }, 'WHOOP sync: history-range fetch failed');
    return { appended: 0, updated: 0, reason: 'whoop unreachable' };
  }

  let sheetRows: unknown[][];
  try {
    sheetRows = (await bridge.readSheet(SHEET, 'A1:H3000')) as unknown[][];
  } catch (err) {
    // If we cannot read the sheet we cannot dedupe — a duplicate row is worse
    // than a gap, because the trend maths treats each row as an observation.
    logger.warn({ err }, 'WHOOP sync: could not read history; skipping');
    return { appended: 0, updated: 0, reason: 'sheet unreadable' };
  }

  const plan = planWhoopSync(sheetRows, apiRows, config.tz);
  let appended = 0;
  let updated = 0;
  for (const a of plan.appends.sort((x, y) => x.date.localeCompare(y.date))) {
    try {
      await bridge.whoopSnapshot({
        date: a.date,
        recovery: a.row.recovery,
        hrv: a.row.hrv,
        restingHeartRate: a.row.restingHeartRate,
        sleepHours: a.row.sleepHours ?? 0,
        sleepScore: a.row.sleepScore,
        strain: a.row.strain ?? 0,
        skinTemp: a.row.skinTemp,
      });
      appended++;
    } catch (err) {
      logger.warn({ err, date: a.date }, 'WHOOP sync: append failed');
    }
  }
  for (const u of plan.updates) {
    try {
      await bridge.updateSheetRange(SHEET, `${STRAIN_COL}${u.rowNum}`, [[u.to]]);
      updated++;
    } catch (err) {
      logger.warn({ err, date: u.date }, 'WHOOP sync: strain update failed');
    }
  }
  if (appended || updated) invalidateSnapshot();
  logger.info(
    { appended, updated, finalized: plan.updates.filter((u) => u.final).length, window: `${start}..${end}` },
    'WHOOP sync complete',
  );
  return { appended, updated };
}

/** Back-compat name used by the scheduler. */
export const syncWhoopSnapshot = () => syncWhoopHistory(3);
