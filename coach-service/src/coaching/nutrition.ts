import { bridge } from '../bridge/client.js';
import { config } from '../config.js';
import { todayStr } from '../util/time.js';
import { logger } from '../logger.js';

/**
 * Nutrition lives in the canonical Google Sheet `NUTRITION_LOG` — one visible
 * source of truth (you can see/correct it; the snapshot computes totals/trends
 * from it). No hidden store, no derived numbers copied anywhere. The coach logs
 * via `log_meal`; totals are computed on read so they can never go stale or
 * contradict what's recorded.
 *
 * Sheet columns: Date | Time | Meal | Food | Protein_g
 */

// ~1.0 g/lb bodyweight at ~148 lb (GOAL.md 2026-10-05). Evidence: muscle-retention
// benefit plateaus ~0.7-1.0 g/lb (Morton 2018 meta-analysis); lean lifters in a
// deficit sit at the top of that range (Helms 2014). Revisit if weight moves >5 lb.
export const PROTEIN_TARGET_G = 150;
const SHEET = 'NUTRITION_LOG';
const HEADER = ['Date', 'Time', 'Meal', 'Food', 'Protein_g'];

let tabEnsured = false;
async function ensureTab(): Promise<void> {
  if (tabEnsured) return;
  try {
    const tabs = await bridge.listSheets();
    if (!tabs.some((t) => t.title === SHEET)) {
      await bridge.createSheet(SHEET);
      await bridge.appendSheet(SHEET, [HEADER]);
      logger.info('Created NUTRITION_LOG sheet');
    }
    tabEnsured = true;
  } catch (err) {
    logger.error({ err }, 'ensureTab(NUTRITION_LOG) failed');
    throw err;
  }
}

interface Meal { date: string; meal: string; food: string; proteinG: number }

/** Read all logged meals (skips header). Returns [] if the tab is missing/unreadable. */
async function readMeals(): Promise<Meal[]> {
  try {
    const rows = (await bridge.readSheet(SHEET)) as unknown[][];
    if (!Array.isArray(rows)) return [];
    return rows
      .slice(1) // header
      .filter((r) => Array.isArray(r) && r[0])
      .map((r) => ({
        date: String(r[0] ?? ''),
        meal: String(r[2] ?? ''),
        food: String(r[3] ?? ''),
        proteinG: Number(r[4]) || 0,
      }));
  } catch {
    return [];
  }
}

export async function logMeal(m: {
  proteinG: number;
  food: string;
  meal?: string;
  /** YYYY-MM-DD the food was EATEN (defaults to today). Lets "yesterday I had…" land on the right day. */
  date?: string;
}): Promise<{ totalG: number; remainingG: number; date: string }> {
  await ensureTab();
  const today = todayStr(config.tz);
  const date = m.date && /^\d{4}-\d{2}-\d{2}$/.test(m.date) ? m.date : today;
  // Local wall-clock time (was UTC, which made 6:40 AM read as 10:40).
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const grams = Number(m.proteinG) || 0;
  await bridge.appendSheet(SHEET, [[date, time, (m.meal ?? '').toLowerCase(), m.food ?? '', grams]]);
  const meals = await readMeals();
  const total = meals.filter((x) => x.date === date).reduce((a, x) => a + x.proteinG, 0);
  return { totalG: total, remainingG: Math.max(0, PROTEIN_TARGET_G - total), date };
}

export async function todayProteinTotal(): Promise<{ totalG: number; remainingG: number; meals: number }> {
  const date = todayStr(config.tz);
  const today = (await readMeals()).filter((x) => x.date === date);
  const total = today.reduce((a, x) => a + x.proteinG, 0);
  return { totalG: total, remainingG: Math.max(0, PROTEIN_TARGET_G - total), meals: today.length };
}

/** Compact one-line protein summary for the snapshot, or '' if nothing logged today. */
export async function todayProteinLine(): Promise<string> {
  const date = todayStr(config.tz);
  const today = (await readMeals()).filter((x) => x.date === date);
  if (!today.length) {
    // Always emit an authoritative anchor — never leave the model to sum from chat.
    return `Protein today: 0g / ${PROTEIN_TARGET_G}g logged (nothing logged yet — log meals Matt mentions; do not infer a total from chat).`;
  }
  const total = today.reduce((a, x) => a + x.proteinG, 0);
  const parts = today.map((m) => `${m.meal || m.food.slice(0, 12) || 'meal'} ${Math.round(m.proteinG)}g`);
  const remaining = Math.max(0, PROTEIN_TARGET_G - total);
  return `Protein today: ${Math.round(total)}g / ${PROTEIN_TARGET_G}g (${parts.join(', ')}) — ${remaining}g to go.`;
}

/** 7-day adherence trend (excludes today) for the snapshot/weekly review. '' if no history. */
export async function proteinTrendLine(): Promise<string> {
  const today = todayStr(config.tz);
  const meals = (await readMeals()).filter((x) => x.date < today);
  if (!meals.length) return '';
  const byDate: Record<string, number> = {};
  for (const m of meals) byDate[m.date] = (byDate[m.date] || 0) + m.proteinG;
  const dates = Object.keys(byDate).sort().slice(-7);
  if (!dates.length) return '';
  const totals = dates.map((d) => byDate[d]);
  const avg = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
  const hit = totals.filter((t) => t >= PROTEIN_TARGET_G).length;
  return `Protein ${dates.length}-day: avg ${avg}g/day, hit ${PROTEIN_TARGET_G}g target on ${hit}/${dates.length} days.`;
}
