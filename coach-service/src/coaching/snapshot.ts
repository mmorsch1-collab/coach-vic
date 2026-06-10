import { bridge } from '../bridge/client.js';
import { logger } from '../logger.js';
import {
  parseWorkoutDb,
  exerciseSeries,
  slopePerWeek,
  weeklyHardSets,
  muscleOf,
  daysSince,
  VOLUME_BANDS,
  type SetLog,
} from './metrics.js';
import { todayProteinLine, proteinTrendLine } from './nutrition.js';

/**
 * The always-loaded coaching SNAPSHOT — a compact digest of Matt's current
 * training + recovery + body-comp state, computed from the sheets and injected
 * into every prompt so the coach "knows him" without re-reading raw data.
 * Cached briefly; invalidated when a set is logged.
 */

let cache: { text: string; at: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

export function invalidateSnapshot(): void {
  cache = null;
}

function parseGeneric(rows: unknown[][]): Array<Record<string, string>> {
  if (!rows || rows.length < 2) return [];
  const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = String((r || [])[i] ?? '').trim()));
    return o;
  });
}
const num = (v: string) => (v && Number.isFinite(Number(v)) ? Number(v) : NaN);

export async function buildSnapshot(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text;

  const [wdb, whoop, bcomp, goals] = await Promise.all([
    bridge.readSheet('WORKOUT_DATABASE').catch(() => [] as unknown[][]),
    bridge.readSheet('WHOOP_History').catch(() => [] as unknown[][]),
    bridge.readSheet('BODY_COMPOSITION').catch(() => [] as unknown[][]),
    bridge.getGoals().catch(() => [] as unknown[]),
  ]);

  const lines: string[] = ['===== COACHING SNAPSHOT (computed; your working memory of Matt) ====='];

  // ---- Training: key lifts + per-muscle weekly volume ----
  const logs: SetLog[] = parseWorkoutDb(wdb as unknown[][]);
  if (logs.length) {
    // Key lifts = most-logged exercises in the last 35 days.
    const recent = logs.filter((l) => daysSince(l.date) <= 35);
    const freq: Record<string, number> = {};
    recent.forEach((l) => (freq[l.exercise] = (freq[l.exercise] || 0) + 1));
    const keyLifts = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e]) => e);

    lines.push('Key lifts (e1RM trend = est. 1RM change/week):');
    for (const lift of keyLifts) {
      const s = exerciseSeries(logs, lift);
      if (!s.length) continue;
      const last = s[s.length - 1];
      const slope = slopePerWeek(s.slice(-6).map((p) => ({ date: p.date, y: p.topE1rm })));
      const arrow = slope > 0.5 ? '↑' : slope < -0.5 ? '↓' : '→';
      lines.push(
        `  • ${lift}: ${last.weight}lb×${last.topReps} (e1RM ${last.topE1rm}) ${arrow} ${slope >= 0 ? '+' : ''}${slope.toFixed(1)}/wk, ${daysSince(last.date)}d ago`,
      );
    }

    const hs = weeklyHardSets(logs, 7);
    const muscles = Object.keys(VOLUME_BANDS);
    const volLine = muscles.map((m) => {
      const n = hs[m] || 0;
      const b = VOLUME_BANDS[m];
      const flag = n < b.mev ? '⚠low' : n > b.mrv ? '⚠high' : 'ok';
      return `${m} ${n}(${flag})`;
    });
    lines.push(`Weekly hard sets vs landmarks: ${volLine.join(', ')}`);

    // Days since each muscle trained.
    const lastByMuscle: Record<string, string> = {};
    logs.forEach((l) => {
      const m = muscleOf(l.exercise);
      if (!lastByMuscle[m] || l.date > lastByMuscle[m]) lastByMuscle[m] = l.date;
    });
    lines.push(
      'Days since trained: ' +
        Object.entries(lastByMuscle).map(([m, d]) => `${m} ${daysSince(d)}d`).join(', '),
    );
    const sessions7 = new Set(logs.filter((l) => daysSince(l.date) <= 7).map((l) => l.date)).size;
    lines.push(`Sessions last 7d: ${sessions7}`);
  } else {
    lines.push('Training: no WORKOUT_DATABASE history yet.');
  }

  // ---- Recovery (WHOOP_History) ----
  const whoopRows = parseGeneric(whoop as unknown[][])
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r['date']))
    .sort((a, b) => b['date'].localeCompare(a['date']));
  if (whoopRows.length) {
    const last7 = whoopRows.slice(0, 7);
    const avg = (k: string) => {
      const xs = last7.map((r) => num(r[k])).filter(Number.isFinite);
      return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : NaN;
    };
    const recSlope = slopePerWeek(whoopRows.slice(0, 14).map((r) => ({ date: r['date'], y: num(r['recovery']) })));
    lines.push(
      `Recovery: 7d avg ${avg('recovery')}% (${recSlope >= 0 ? '+' : ''}${recSlope.toFixed(1)}/wk), HRV 7d ${avg('hrv')}, sleep 7d ${avg('sleep hours')}h. Latest ${whoopRows[0]['date']}: rec ${whoopRows[0]['recovery']}%.`,
    );
  }

  // ---- Body composition ----
  const bcRows = parseGeneric(bcomp as unknown[][])
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r['date']) && Number.isFinite(num(r['weight_lbs'])));
  if (bcRows.length) {
    const sorted = bcRows.sort((a, b) => b['date'].localeCompare(a['date']));
    const latest = sorted[0];
    const wSlope = slopePerWeek(sorted.slice(0, 21).map((r) => ({ date: r['date'], y: num(r['weight_lbs']) })));
    const bf = sorted.map((r) => num(r['body_fat_%'])).filter(Number.isFinite)[0];
    lines.push(
      `Body comp: ${latest['weight_lbs']}lb${Number.isFinite(bf) ? `, ~${bf}% BF` : ''} (latest ${latest['date']}). Weight trend ${wSlope >= 0 ? '+' : ''}${wSlope.toFixed(2)} lb/wk.`,
    );
  }

  // ---- Goals ----
  if (Array.isArray(goals) && goals.length) {
    const active = (goals as any[]).filter((g) => g.active !== false && g.active !== 'FALSE');
    if (active.length) lines.push('Goals: ' + active.map((g) => `${g.name} (${g.current}/${g.target})`).join('; '));
  }

  // ---- Nutrition (deterministic running total; never rely on chat recall) ----
  const proteinLine = await todayProteinLine();
  if (proteinLine) lines.push(proteinLine);
  const proteinTrend = await proteinTrendLine();
  if (proteinTrend) lines.push(proteinTrend);

  lines.push('(Use get_exercise_progression / get_muscle_volume / get_bodycomp_trend for detail.)');
  const text = lines.join('\n');
  cache = { text, at: Date.now() };
  logger.debug('Snapshot rebuilt');
  return text;
}
