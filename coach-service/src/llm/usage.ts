import { JsonStore } from '../state/jsonStore.js';
import { config } from '../config.js';
import { todayStr } from '../util/time.js';
import { logger } from '../logger.js';

/**
 * Per-turn token usage + cost logging, so model/cost decisions (Haiku vs Sonnet)
 * run on real numbers, not estimates. Accumulates a running daily total in
 * usage.json and logs one line per LLM turn.
 */

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
interface Pricing { in: number; out: number; cacheRead: number; cacheWrite: number } // $ per 1M tokens

function pricingFor(model: string): Pricing {
  const m = model.toLowerCase();
  if (m.includes('opus')) return { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 };
  if (m.includes('sonnet')) return { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  if (!m.includes('haiku')) {
    // Unknown family (model ids are free-form env vars) — cost tracking would
    // silently drift if a future model priced differently lands in the fallback.
    logger.warn({ model }, 'pricingFor: unknown model family — pricing as Haiku');
  }
  return { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 }; // haiku / default
  // NOTE: cacheWrite assumes the 5-min-TTL multiplier (1.25x). 1h-TTL writes
  // (main chat prefix) bill at 2x — the report slightly understates those.
}

export function costOf(model: string, u: Usage): number {
  const p = pricingFor(model);
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}

export interface DayUsage {
  calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number;
  // Chat-only slice (sessionType 'main') so the cost report can isolate chat from scheduled jobs.
  mainCalls: number; mainCost: number;
}
const store = new JsonStore<{ byDate: Record<string, DayUsage> }>('usage.json', { byDate: {} });

/** Read one day's aggregated usage (or null) — for the daily close cache-health check. */
export async function readDayUsage(date: string): Promise<DayUsage | null> {
  const s = await store.read();
  return s.byDate[date] ?? null;
}

export async function recordTurnUsage(p: {
  model: string;
  tier: string;
  sessionType: string;
  usage: Usage;
}): Promise<void> {
  const turnCost = costOf(p.model, p.usage);
  const date = todayStr(config.tz);
  const day = await store.update((s) => {
    if (!s.byDate[date]) s.byDate[date] = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, mainCalls: 0, mainCost: 0 };
    const d = s.byDate[date];
    if (d.mainCalls == null) { d.mainCalls = 0; d.mainCost = 0; } // backfill older entries
    d.calls += 1;
    d.input += p.usage.input;
    d.output += p.usage.output;
    d.cacheRead += p.usage.cacheRead;
    d.cacheWrite += p.usage.cacheWrite;
    d.cost += turnCost;
    if (p.sessionType === 'main') {
      d.mainCalls += 1;
      d.mainCost += turnCost;
    }
    return d;
  });
  logger.info(
    {
      model: p.model,
      tier: p.tier,
      session: p.sessionType,
      in: p.usage.input,
      out: p.usage.output,
      cacheRead: p.usage.cacheRead,
      cacheWrite: p.usage.cacheWrite,
      turnCost: Number(turnCost.toFixed(4)),
      dayCost: Number(day.cost.toFixed(2)),
    },
    'LLM turn usage',
  );
}
