import { bridge } from '../bridge/client.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { assessWhoop } from '../scheduler/gating.js';
import { assessFreshness, STALE_LABEL } from './whoopFreshness.js';
import {
  parseWorkoutDb,
  exerciseSeries,
  slopePerWeek,
  hardSetsInRange,
  sessionDatesInRange,
  muscleOf,
  daysSince,
  hrvDropStreak,
  strainPattern,
  regressingLifts,
  muscleRetentionAlarm,
  unclassifiedExercises,
  VOLUME_BANDS,
  type SetLog,
  type WhoopRow,
} from './metrics.js';
import { todayProteinLine, proteinTrendLine } from './nutrition.js';
import { parseBodyCompSheet, weightTrend, muscleSlope14 } from './bodyComp.js';
import { bodyCompReviewStatus } from './bodyCompReview.js';
import { allFeedback, recentPain, summarizeMmc } from './feedback.js';
import { calendarWeek, weekdayLabel, hourOfTimestamp, todayStr, hourInTz, addDaysStr } from '../util/time.js';

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
const sign = (n: number, d = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;

export async function buildSnapshot(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text;

  const [wdb, whoop, bcomp, goals, tabs, whoopToday, wHist] = await Promise.all([
    bridge.readSheet('WORKOUT_DATABASE').catch(() => [] as unknown[][]),
    bridge.readSheet('WHOOP_History').catch(() => [] as unknown[][]),
    bridge.readSheet('BODY_COMPOSITION').catch(() => [] as unknown[][]),
    bridge.getGoals().catch(() => [] as unknown[]),
    bridge.listSheets().catch(() => [] as Array<{ title: string }>),
    assessWhoop('ritual').catch(() => null),
    bridge.withingsHistory(21).catch(() => [] as unknown),
  ]);

  const week = calendarWeek(config.tz);
  const lines: string[] = ['===== COACHING SNAPSHOT (computed; your working memory of Matt) ====='];
  lines.push(`Calendar week (volume scope): Mon ${week.start} → Sun ${week.end} (${config.tz}).`);

  // ---- Training: key lifts + per-muscle CALENDAR-WEEK volume ----
  const logs: SetLog[] = parseWorkoutDb(wdb as unknown[][]);
  let keyLifts: string[] = [];
  if (logs.length) {
    // Key lifts = most-logged exercises in the last 35 days.
    const recent = logs.filter((l) => daysSince(l.date) <= 35);
    const freq: Record<string, number> = {};
    recent.forEach((l) => (freq[l.exercise] = (freq[l.exercise] || 0) + 1));
    keyLifts = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e]) => e);

    lines.push('Key lifts (e1RM trend = est. 1RM change/week):');
    for (const lift of keyLifts) {
      const s = exerciseSeries(logs, lift);
      if (!s.length) continue;
      const last = s[s.length - 1];
      const slope = slopePerWeek(s.slice(-6).map((p) => ({ date: p.date, y: p.topE1rm })));
      const arrow = slope > 0.5 ? '↑' : slope < -0.5 ? '↓' : '→';
      lines.push(
        `  • ${lift}: ${last.weight}lb×${last.topReps} (e1RM ${last.topE1rm}) ${arrow} ${sign(slope)}/wk, ${daysSince(last.date)}d ago`,
      );
    }

    // CALENDAR-week hard sets (Mon–Sun), NOT a rolling 7-day window.
    const hs = hardSetsInRange(logs, week.start, week.end);
    const volLine = Object.keys(VOLUME_BANDS).map((m) => {
      const n = hs[m] || 0;
      const b = VOLUME_BANDS[m];
      // The mandate is to LAND on MAV, so "how many sets left" is the useful
      // signal — and hitting MRV is a ceiling to stop at, not a quiet "ok".
      const flag =
        n > b.mrv ? '⚠OVER MRV' : n >= b.mrv ? '⚠at MRV — stop' : n >= b.mav ? '✓MAV' : `+${b.mav - n}`;
      return `${m} ${n}/${b.mav}(${flag})`;
    });
    lines.push(
      `Hard sets THIS CALENDAR WEEK vs MAV (+N = sets still to place this week): ${volLine.join(', ')}`,
    );

    // Days since each muscle trained.
    const lastByMuscle: Record<string, string> = {};
    logs.forEach((l) => {
      const m = muscleOf(l.exercise);
      if (m === 'warmup') return; // mobility work is not "training that muscle"
      if (!lastByMuscle[m] || l.date > lastByMuscle[m]) lastByMuscle[m] = l.date;
    });
    lines.push(
      'Days since trained: ' +
        Object.entries(lastByMuscle).map(([m, d]) => `${m} ${daysSince(d)}d`).join(', '),
    );
    const wkDates = sessionDatesInRange(logs, week.start, week.end);
    lines.push(
      `Sessions logged this week: ${wkDates.length}` +
        (wkDates.length ? ` (${wkDates.map((d) => `${weekdayLabel(d)} ${d}`).join(', ')})` : ''),
    );
  } else {
    lines.push('Training: no WORKOUT_DATABASE history yet.');
  }

  // ---- UNCLASSIFIED EXERCISES: novel lifts the volume counter can't place ----
  // A swapped-in machine/cable variant the classifier doesn't know falls through
  // to 'other' and its sets vanish from the weekly count. Surface it so Vic asks
  // Matt (and calls classify_exercise) instead of silently under-counting.
  {
    const recentLogs = logs.filter((l) => daysSince(l.date) <= 21);
    const unknown = unclassifiedExercises(recentLogs);
    if (unknown.length) {
      lines.push(
        `⚠ UNCLASSIFIED EXERCISE(S) — not counted in any muscle's volume: ${unknown.map((e) => `"${e}"`).join(', ')}. ` +
          `Ask Matt which muscle each primarily works (offer your best guess) and call ` +
          `classify_exercise to record it — fold this into any "how did it feel / effort / joints" ` +
          `debrief. Until classified, the weekly volume above under-counts these sets.`,
      );
    }
  }

  // ---- INGEST AUDIT: sheets built this week with nothing in the database ----
  // Silent stale data is worse than a visible warning: without this, volume
  // counts read low and the coach autoregulates off numbers Matt already beat.
  {
    const dbDates = new Set(logs.map((l) => l.date));
    const weekTabs = (Array.isArray(tabs) ? tabs : [])
      .map((t) => String((t as { title?: string })?.title ?? ''))
      .map((title) => ({ title, date: /^Workout_(\d{4}-\d{2}-\d{2})$/.exec(title)?.[1] }))
      // Attribute by the SHEET'S DATE, never a weekday label in the title.
      .filter((t): t is { title: string; date: string } => !!t.date && t.date >= week.start && t.date <= week.end);
    const unIngested = weekTabs.filter((t) => !dbDates.has(t.date)).sort((a, b) => a.date.localeCompare(b.date));
    if (unIngested.length) {
      lines.push(
        `⚠ INGEST GAP — Workout sheet(s) exist for this week with NO rows in WORKOUT_DATABASE: ` +
          unIngested.map((t) => `${t.title} (${weekdayLabel(t.date)})`).join(', ') +
          `. The set counts above are STALE and under-count. Call ingest_workout for these dates ` +
          `BEFORE reporting volume or making an autoregulation call. If a sheet was built but never ` +
          `trained, say so explicitly rather than treating it as volume.`,
      );
    }
  }

  // ---- Recovery / WHOOP ----
  const whoopRows: WhoopRow[] = parseGeneric(whoop as unknown[][])
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r['date']))
    .sort((a, b) => b['date'].localeCompare(a['date']))
    .map((r) => ({
      date: r['date'],
      recovery: num(r['recovery']),
      hrv: num(r['hrv']),
      rhr: num(r['resting hr']),
      sleepHours: num(r['sleep hours']),
      strain: num(r['strain']),
    }));

  // TODAY, from the live WHOOP API, behind the hard freshness gate
  // (whoopFreshness.ts): during the briefing window (through workout hour + 2) the
  // recovery must be SCORED and <=2h old; after that, SCORED and scored TODAY.
  // Anything else is labeled stale — it is never shown as today's numbers. (The
  // old ±1-day check compared the bridge's request-time "date", so a 78.8h-old
  // score passed as today.)
  {
    const workoutHour = Number(config.workoutTime.split(':')[0]);
    const inBriefingWindow = hourInTz(config.tz) <= workoutHour + 2;
    const fr = assessFreshness(whoopToday?.data?.recovery?.metadata, inBriefingWindow ? 'ritual' : 'checkin', config.tz);
    const ageH = fr.ageHours ?? NaN;
    const usable = !!whoopToday?.ok && fr.usable;

    if (usable) {
      const d = whoopToday!.data;
      const age = Number.isFinite(ageH) ? `${ageH.toFixed(1)}h old` : 'age unknown';
      const r1 = (v: number | null | undefined) =>
        v == null || !Number.isFinite(v) ? '?' : String(Math.round(v * 10) / 10);
      lines.push(
        `WHOOP today (SCORED, ${age}): recovery ${whoopToday!.recovery ?? '?'}% (${whoopToday!.color}), ` +
          `HRV ${r1(d?.recovery?.hrv)}ms, RHR ${r1(d?.recovery?.restingHeartRate)}, ` +
          `sleep ${r1(d?.sleep?.durationHours)}h, strain ${r1(whoopToday!.strain)}.`,
      );
    } else if (!whoopToday?.ok && !whoopToday?.authError) {
      // TRANSIENT fetch failure (WHOOP token refresh 502s are common and
      // self-clear) — NOT a data-quality problem. The data itself may be
      // perfectly good; we just didn't get it on this attempt, and the snapshot
      // is cached for 10 minutes. Blocking recovery coaching outright here
      // would silence Vic on a blip, so: retry through the tool instead.
      lines.push(
        `⚠ WHOOP fetch failed transiently this snapshot (${whoopToday?.reason ?? 'fetch failed'}) — ` +
          `this is a known flaky token refresh, NOT stale data. If recovery matters this turn, ` +
          `call get_whoop_today to retry, then apply the usual SCORED + freshness check to what ` +
          `it returns. Only skip recovery coaching if that retry also fails.`,
      );
    } else {
      const why = !whoopToday?.ok ? `${STALE_LABEL} — ${whoopToday?.reason ?? 'not authenticated'}` : fr.label;
      lines.push(
        `⚠ WHOOP: ${why}. SKIP RECOVERY COACHING ENTIRELY this session: no ` +
          `recovery %, no readiness call, no "your HRV says…", no strain commentary. Never ` +
          `substitute yesterday's score for today's. Coach off logged performance instead, and ` +
          `if recovery is genuinely needed, say the data isn't in yet.`,
      );
    }
  }

  if (whoopRows.length) {
    // By DAYS, not by rows: WHOOP_History has gaps and duplicate dates, so
    // slice(0,7) could average records spanning months and label it "7d".
    const last7 = whoopRows.filter((r) => daysSince(r.date) <= 7);
    const avg = (pick: (r: WhoopRow) => number) => {
      const xs = last7.map(pick).filter(Number.isFinite);
      return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : NaN;
    };
    // Multi-day trend is the intensity-modifier signal — never a single day.
    const recent14 = whoopRows.filter((r) => daysSince(r.date) <= 14);
    const recSlope = slopePerWeek(recent14.map((r) => ({ date: r.date, y: r.recovery })));
    if (last7.length) {
      lines.push(
        `Recovery trend (multi-day — THIS is the intensity modifier, not any single day): ` +
          `7d avg ${avg((r) => r.recovery)}% (${sign(recSlope)}/wk), HRV 7d ${avg((r) => r.hrv)}ms, ` +
          `RHR 7d ${avg((r) => r.rhr)}, sleep 7d ${avg((r) => r.sleepHours)}h ` +
          `(from ${last7.length} record(s) in the last 7 days).`,
      );
    } else {
      // The sheet is written by save_whoop_snapshot (a morning-ritual step), so
      // it goes stale whenever the ritual is off — even while TODAY's live
      // recovery is arriving fine. Say that, so this never reads as "WHOOP is
      // down": today's numbers above are independent of this backlog.
      lines.push(
        `⚠ No WHOOP_History records in the last 7 days (latest ${whoopRows[0].date}) — the ` +
          `multi-day trend, HRV-streak and strain signals are UNAVAILABLE (not "flat", not "fine"). ` +
          `This is a logging gap, not a WHOOP outage: today's live recovery above is unaffected. ` +
          `Do not infer a trend from older records; use save_whoop_snapshot to start refilling it.`,
      );
    }

    const drop = hrvDropStreak(whoopRows);
    if (drop.days >= 3) {
      lines.push(
        `⚠ HRV 7d avg down ${drop.dropPct}% for ${drop.days} consecutive days. This is an ` +
          `INTENSITY MODIFIER ONLY — cap intensity, hold sets, watch rep quality. It is NOT the ` +
          `muscle-retention alarm and must never be reported as muscle loss on its own.`,
      );
    } else if (drop.days > 0) {
      lines.push(`HRV 7d avg down ${drop.dropPct}% for ${drop.days}d (<3d — noise, do not act).`);
    }

    const workoutDates = new Set(logs.map((l) => l.date));
    const sp = strainPattern(whoopRows, workoutDates);
    if (sp.workoutDays > 0) {
      if (sp.lowConfidence) {
        // Morning-captured strain, not day totals — report it, but never coach
        // "add intensity" off it (see strainPattern's doc comment).
        lines.push(
          `Workout-day strain (last 14d): avg ${sp.avg} over ${sp.workoutDays} days — ` +
            `IMPLAUSIBLY LOW, so these are morning captures (strain-so-far at wake), not day ` +
            `totals. Do NOT call Matt undertrained or tell him to add intensity from this. ` +
            `Strain data is effectively unavailable; judge effort from logged sets/RIR instead.`,
        );
      } else {
        lines.push(
          `Workout-day strain (last 14d): avg ${sp.avg} over ${sp.workoutDays} days (target ~12–15).` +
            (sp.flag === 'recovery_debt' ? ` ⚠ strain >16 on ${sp.high} day(s) — recovery debt building.` : ''),
        );
      }
    }
  }

  // ---- Body composition / Withings ----
  // Cleaned points: blank/zero/implausible BF% & muscle are MISSING (bodyComp.ts) —
  // the 2026-10-08 failed reading used to count as 0 and fake a muscle drop.
  const bcPts = parseBodyCompSheet(bcomp as unknown[][]);
  const today = todayStr(config.tz);
  let weightSlope = NaN;
  let muscleSlope = NaN;
  if (bcPts.length) {
    const withWeight = bcPts.filter((p) => p.weight != null);
    const latest = withWeight[withWeight.length - 1];
    const bfRow = [...bcPts].reverse().find((p) => p.bf != null);
    if (latest) {
      lines.push(
        `Body comp: ${latest.weight}lb (measured ${latest.date})` +
          (bfRow ? `, ${bfRow.bf}% BF (measured ${bfRow.date})` : ', BF% unavailable') +
          '.',
      );
    }

    // Rate vs the goal band: TWO regression windows. "Too fast" only when both agree,
    // so one stale high point (e.g. the Sept 25–30 150–151 lb readings) can't trip it.
    const wt = weightTrend(bcPts, today);
    // The muscle-retention alarm needs "weight dropping": use the recent (14d) fit,
    // falling back to 21d only when 14d has too few readings.
    weightSlope = wt.slope14 ?? wt.slope21 ?? NaN;
    const f = (x: number | null, n: number) => (x == null ? `n/a (${n} readings)` : `${sign(x, 2)} lb/wk`);
    lines.push(
      `Weight trend (least-squares): 14d ${f(wt.slope14, wt.n14)}, 21d ${f(wt.slope21, wt.n21)} → ${wt.note}.`,
    );

    // Muscle mass: 2-week TREND only — single readings are glycogen/hydration noise.
    const ms = muscleSlope14(bcPts, today);
    if (ms.slope != null) {
      muscleSlope = ms.slope;
      const dir = muscleSlope < -0.1 ? '⚠ DOWN' : muscleSlope > 0.1 ? 'up' : 'flat';
      lines.push(`Muscle mass 2wk trend: ${sign(muscleSlope, 2)} lb/wk (${dir}, ${ms.n} valid readings).`);
    } else {
      lines.push(`Muscle mass 2wk trend: insufficient valid readings (${ms.n}) — do not infer a direction.`);
    }

  }

  // 4-weekly formal body-comp review: due ONCE per 4-week window and cleared when
  // delivered (bodyCompReview.ts) — no longer re-raised on every turn for a week.
  try {
    const rv = await bodyCompReviewStatus(today);
    if (rv.due) {
      lines.push(
        `📋 Monthly body-comp review due (4-week window ${rv.window}, week ${rv.weeksIn} of the Miami ` +
          `timeline). It runs in the Sunday weekly review — do not raise it unprompted in chat. If Matt ` +
          `asks for it, do it (BF% + muscle trend from get_bodycomp_trend vs the ~0.3–0.5% BF/month ` +
          `target and the Dec 29 date), then call complete_bodycomp_review.`,
      );
    }
  } catch {
    /* best-effort */
  }

  // Measurement-timing hygiene: scattered weigh-in times add noise to the slope.
  {
    const hist = Array.isArray(wHist) ? (wHist as Array<{ date?: string }>) : [];
    const hours = hist
      .map((h) => hourOfTimestamp(String(h?.date ?? ''), config.tz))
      .filter((h) => Number.isFinite(h));
    if (hours.length >= 5) {
      const morning = hours.filter((h) => h >= 4 && h <= 11).length;
      const pct = Math.round((morning / hours.length) * 100);
      if (pct < 70) {
        lines.push(
          `⚠ Weigh-in timing inconsistent: only ${pct}% of the last ${hours.length} Withings ` +
            `readings were morning (4–11am). Scattered timing adds noise to the weight slope — ` +
            `treat the trend as lower-confidence and mention consistent morning weigh-ins ` +
            `(post-void, pre-food) when discussing it.`,
        );
      }
    }
  }

  // ---- Muscle-retention alarm: ALL THREE conditions, never fewer ----
  {
    const regressing = regressingLifts(logs, keyLifts);
    const alarm = muscleRetentionAlarm({ regressing, muscleMassSlope: muscleSlope, weightSlope });
    if (alarm.firing) {
      lines.push(
        `🚨 MUSCLE-RETENTION ALARM — all three conditions met (${alarm.met.join('; ')}): ` +
          `e1RM regressing on ${regressing.join(', ')}, muscle mass down over 2wk, weight dropping. ` +
          `Action: raise protein toward 1.2g/lb, shrink the deficit toward maintenance, cut cardio. ` +
          `If regression continues, end the cut.`,
      );
    } else if (alarm.met.length) {
      lines.push(
        `Muscle-retention watch (NOT the alarm — needs all 3): met [${alarm.met.join('; ')}], ` +
          `missing [${alarm.missing.join('; ')}]. Do NOT tell Matt he is losing muscle on a partial signal.`,
      );
    }
  }

  // ---- Workout feedback (RIR / mind-muscle / pain) — each drives a decision ----
  try {
    const fb = await allFeedback();
    // Pain: recent tweaks → caution + substitution (esp. back/hip, see USER.md).
    const pain = recentPain(fb, 21);
    if (pain.length) {
      const top = pain.slice(0, 4).map((p) => `${p.area}${p.severity !== 'mild' ? ` (${p.severity})` : ''} — ${p.exercise} ${p.date}`);
      lines.push(
        `⚠ Recent pain/tweaks (last 21d): ${top.join('; ')}. Factor into exercise selection and ` +
          `load — prefer the spine/joint-friendly variant, back off load (keep sets), and check in ` +
          `on how it's feeling before loading that pattern again.`,
      );
    }
    // Mind-muscle: exercises that give little/no connection → replacement candidates.
    const mmc = summarizeMmc(fb, 42);
    const replace = mmc.filter((s) => s.replaceCandidate);
    if (replace.length) {
      lines.push(
        `Low mind-muscle (${replace.length}) — propose swaps: ` +
          replace.map((s) => `${s.exercise} (weak/none ×${s.weakOrNone})`).join(', ') +
          `. Matt feels little in these; suggest a better-connecting variant for the same muscle.`,
      );
    }
    const keep = mmc.filter((s) => s.strong >= 2 && !s.replaceCandidate).slice(0, 4);
    if (keep.length) {
      lines.push(`Strong mind-muscle (bias toward these): ${keep.map((s) => s.exercise).join(', ')}.`);
    }
  } catch {
    /* feedback is best-effort */
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
