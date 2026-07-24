import { bridge } from '../bridge/client.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { assessWhoop } from '../scheduler/gating.js';
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
import { calendarWeek, weekdayLabel, hourOfTimestamp, todayStr, hourInTz, addDaysStr } from '../util/time.js';

/**
 * The always-loaded coaching SNAPSHOT — a compact digest of Matt's current
 * training + recovery + body-comp state, computed from the sheets and injected
 * into every prompt so the coach "knows him" without re-reading raw data.
 * Cached briefly; invalidated when a set is logged.
 */

let cache: { text: string; at: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

/** Miami-goal timeline anchor (GOAL.md) — drives the 4-weekly body-comp review. */
const MIAMI_ANCHOR = '2026-07-18';
/** Goal cut rate (GOAL.md): 0.5–0.75 lb/week. */
const TARGET_LOSS_MIN = 0.5;
const TARGET_LOSS_MAX = 0.75;

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

/**
 * Numeric value of the first header containing EVERY given substring (headers
 * are lowercased by parseGeneric). BODY_COMPOSITION was hand-created, so its
 * exact column spellings aren't guaranteed — match tolerantly rather than
 * hard-coding a name and silently reading NaN forever.
 */
function field(row: Record<string, string>, ...parts: string[]): number {
  const k = Object.keys(row).find((h) => parts.every((p) => h.includes(p)));
  return k ? num(row[k]) : NaN;
}
/** Body-fat %, never "fat free mass" / "visceral fat" (same rule as get_bodycomp_trend). */
function bodyFat(row: Record<string, string>): number {
  const bf = field(row, 'body', 'fat');
  return Number.isFinite(bf) ? bf : field(row, 'fat', '%');
}

export async function buildSnapshot(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text;

  const [wdb, whoop, bcomp, goals, tabs, whoopToday, wHist] = await Promise.all([
    bridge.readSheet('WORKOUT_DATABASE').catch(() => [] as unknown[][]),
    bridge.readSheet('WHOOP_History').catch(() => [] as unknown[][]),
    bridge.readSheet('BODY_COMPOSITION').catch(() => [] as unknown[][]),
    bridge.getGoals().catch(() => [] as unknown[]),
    bridge.listSheets().catch(() => [] as Array<{ title: string }>),
    assessWhoop(2).catch(() => null),
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

  // TODAY, from the live WHOOP API. Recovery coaching requires score_state ===
  // SCORED and TODAY's score — never yesterday's.
  //
  // The <2h freshness gate is the MORNING-BRIEFING standard: WHOOP scores once
  // after waking, so by mid-morning today's legitimately-scored recovery is
  // always >2h old. Applying 2h all day would blank recovery coaching from ~2h
  // after wake onward (the same trap gating.ts documents for the day-part
  // check-ins). So: strict 2h through the briefing window (workout hour + 2,
  // covering the 5:15-equivalent run and its fallback), SCORED + same-day after
  // that, with the age stated so the coach can weigh it.
  {
    const meta = whoopToday?.data?.recovery?.metadata;
    const scored = meta?.score_state === 'SCORED';
    const updatedAt = meta?.updated_at;
    const ageH = updatedAt ? (Date.now() - Date.parse(updatedAt)) / 3_600_000 : NaN;
    const whoopDate = whoopToday?.data?.date;
    // WHOOP anchors its cycle date to UTC, so after ~8pm ET its "date" is
    // already tomorrow's while our local date is still today. A strict equality
    // check therefore blanked recovery coaching every evening. Accept ±1 day and
    // let the SCORED + freshness checks do the real work of rejecting stale data.
    const localToday = todayStr(config.tz);
    const isToday =
      !/^\d{4}-\d{2}-\d{2}$/.test(String(whoopDate)) ||
      [localToday, addDaysStr(localToday, 1), addDaysStr(localToday, -1)].includes(String(whoopDate));
    const workoutHour = Number(config.workoutTime.split(':')[0]);
    const inBriefingWindow = hourInTz(config.tz) <= workoutHour + 2;
    const freshEnough = inBriefingWindow ? Number.isFinite(ageH) && ageH <= 2 : true;
    const usable = !!whoopToday?.ok && scored && isToday && freshEnough;

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
      const why = !whoopToday?.ok
        ? (whoopToday?.reason ?? 'not authenticated')
        : !scored
          ? `score_state=${meta?.score_state ?? 'missing'} (not SCORED)`
          : !isToday
            ? `data is for ${whoopDate}, not today`
            : `updated_at ${Number.isFinite(ageH) ? `${ageH.toFixed(1)}h` : 'unknown'} old (>2h at briefing time)`;
      lines.push(
        `⚠ WHOOP today UNUSABLE — ${why}. SKIP RECOVERY COACHING ENTIRELY this session: no ` +
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
  const bcRows = parseGeneric(bcomp as unknown[][])
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r['date']) && Number.isFinite(field(r, 'weight')))
    .sort((a, b) => b['date'].localeCompare(a['date']));
  let weightSlope = NaN;
  let muscleSlope = NaN;
  if (bcRows.length) {
    const latest = bcRows[0];
    weightSlope = slopePerWeek(bcRows.slice(0, 21).map((r) => ({ date: r['date'], y: field(r, 'weight') })));
    const bfRow = bcRows.find((r) => Number.isFinite(bodyFat(r)));
    const bf = bfRow ? bodyFat(bfRow) : NaN;
    lines.push(
      `Body comp: ${field(latest, 'weight')}lb (measured ${latest['date']})` +
        (Number.isFinite(bf) ? `, ${bf}% BF (measured ${bfRow!['date']})` : ', BF% unavailable') +
        '.',
    );

    // Rate vs the Miami goal band (loss is a NEGATIVE slope).
    const lossRate = -weightSlope;
    const rateNote =
      !Number.isFinite(weightSlope)
        ? 'insufficient data'
        : lossRate < 0
          ? `GAINING ${Math.abs(lossRate).toFixed(2)} lb/wk — not in deficit`
          : lossRate < TARGET_LOSS_MIN
            ? `below the ${TARGET_LOSS_MIN}–${TARGET_LOSS_MAX} lb/wk target band (slow)`
            : lossRate > TARGET_LOSS_MAX
              ? `⚠ ABOVE the ${TARGET_LOSS_MIN}–${TARGET_LOSS_MAX} lb/wk band — too fast, muscle risk`
              : `on target (${TARGET_LOSS_MIN}–${TARGET_LOSS_MAX} lb/wk)`;
    lines.push(`21d weight slope: ${sign(weightSlope, 2)} lb/wk → ${rateNote}.`);

    // Muscle mass: 2-week TREND only — single readings are glycogen/hydration noise.
    const mmPts = bcRows
      .filter((r) => daysSince(r['date']) <= 14 && Number.isFinite(field(r, 'muscle')))
      .map((r) => ({ date: r['date'], y: field(r, 'muscle') }));
    if (mmPts.length >= 3) {
      muscleSlope = slopePerWeek(mmPts);
      const dir = muscleSlope < -0.1 ? '⚠ DOWN' : muscleSlope > 0.1 ? 'up' : 'flat';
      lines.push(`Muscle mass 2wk trend: ${sign(muscleSlope, 2)} lb/wk (${dir}, ${mmPts.length} readings).`);
    } else {
      lines.push(`Muscle mass 2wk trend: insufficient readings (${mmPts.length}) — do not infer a direction.`);
    }

    // 4-weekly formal body-comp review against the Miami timeline.
    const weeksIn = Math.floor(daysSince(MIAMI_ANCHOR) / 7);
    if (weeksIn >= 4 && weeksIn % 4 === 0) {
      lines.push(
        `📋 MONTHLY BODY COMP REVIEW DUE (week ${weeksIn} of the Miami timeline). Run the formal ` +
          `check-in: BF% + muscle mass trend vs the ~0.3–0.5% BF/month reduction target, and ` +
          `whether the cut rate still fits the Dec 29 date.`,
      );
    }
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
