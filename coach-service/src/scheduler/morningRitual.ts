import { runTurn } from '../llm/agent.js';
import { assessWhoop } from './gating.js';
import { todayStr, localDateTime } from '../util/time.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { isSentinel } from './sentinel.js';

/**
 * The M–F 5:15 AM morning ritual:
 *   WHOOP (best-effort) → Withings → build recovery-appropriate workout sheet →
 *   create the 5:30 calendar block (with sheet link) → send a coach-voice briefing.
 *
 * WHOOP not scored by 5:15 is NORMAL (it scores after wake/sync) and must NEVER
 * block the build — Matt lifts at 5:30, and a 7:00 briefing is useless. Volume
 * isn't WHOOP-gated anyway (SCIENCE.md): when recovery is unscored we build from
 * the weekly plan, assume yellow (cap intensity), and say so. We only stay
 * silent (for the 7:00 fallback) when the BRIDGE itself is unreachable, since
 * sheet/calendar creation would fail too.
 */

export interface RitualResult {
  sent: boolean;
  message?: string;
  reason?: string;
}

export async function runMorningRitual(opts: { force?: boolean } = {}): Promise<RitualResult> {
  const date = todayStr(config.tz);
  const a = await assessWhoop();
  const whoopFresh = !!(a.ok && a.fresh);

  // Bridge down (fetch failed for a non-auth reason): nothing downstream will
  // work either — let the 7:00 fallback retry.
  if (!opts.force && !a.ok && !a.authError) {
    return { sent: false, reason: a.reason ?? 'bridge unavailable' };
  }

  // Workout block from config (WORKOUT_TIME), 60 min long. Moving WORKOUT_TIME
  // shifts both this calendar block and the morning cron schedule together.
  const [wh, wm] = config.workoutTime.split(':').map(Number);
  const endHH = String((wh + 1) % 24).padStart(2, '0');
  const workoutStart = localDateTime(date, config.workoutTime);
  const workoutEnd = localDateTime(date, `${endHH}:${String(wm).padStart(2, '0')}`);

  const whoopLine = whoopFresh
    ? `recovery=${a.recovery}% (${a.color}), strain=${a.strain}, sleep=${a.data?.sleep?.durationHours ?? '?'}h` +
      `${a.data?.sleep?.sleepScore != null ? ` (score ${a.data.sleep.sleepScore})` : ''}, ` +
      `HRV=${a.data?.recovery?.hrv ?? '?'}ms, RHR=${a.data?.recovery?.restingHeartRate ?? '?'}`
    : `NOT SCORED YET (normal at this hour). Build from the weekly plan anyway — volume is NOT ` +
      `WHOOP-gated. Assume YELLOW: keep all planned sets, cap intensity at RIR 1–2, no PR attempts. ` +
      `Do NOT state recovery numbers or make recovery claims. Briefly note in the briefing that ` +
      `WHOOP hadn't scored yet.`;

  const instruction = [
    `It is the weekday morning ritual for ${date} (workout planned for ${config.workoutTime}). Produce Matt's morning briefing.`,
    ``,
    `Today's WHOOP (already fetched — do NOT call get_whoop_today): ${whoopLine}`,
    ``,
    `Do this, using your tools:`,
    `1. If something is genuinely broken (e.g. tools erroring so you cannot build the workout),`,
    `   reply with exactly "STALE" and nothing else — do NOT fabricate coaching.`,
    `2. Call get_withings_latest (and get_withings_history if useful) for body-comp context`,
    `   toward the ~10% body-fat recomposition goal.`,
    `3. Build a recovery-appropriate, goal-aligned workout per WORKOUT_PROTOCOL.md and create it`,
    `   with create_workout (date "${date}"). Capture the returned sheet URL.`,
    `4. Create the workout calendar block with create_calendar_event:`,
    `   title like "🏋️ Workout — <split>", startTime "${workoutStart}", endTime "${workoutEnd}",`,
    `   and put the sheet URL in the description.`,
    whoopFresh
      ? `5. Save today's WHOOP numbers with save_whoop_snapshot.`
      : `5. Skip save_whoop_snapshot (no scored numbers to save).`,
    `6. Optionally remember anything notable (remember / log_today).`,
    ``,
    `Then write the FINAL briefing message to send to Matt on Telegram. Coach voice: calm,`,
    `confident, grounded; lead with how his body is and the plan; mention the workout is built`,
    `and the 5:30 block is set (include the sheet link); end with one question. No data dumps,`,
    `no visible reasoning. The final text you return IS the message that will be sent.`,
  ].join('\n');

  try {
    const result = await runTurn({
      messages: [{ role: 'user', content: instruction }],
      sessionType: 'isolated',
      retrievalQuery: 'morning briefing workout split preferences recovery sleep body composition',
      tier: 'heavy', // workout programming benefits from deeper reasoning
      maxTokens: 1500,
      maxIterations: 12,
    });

    const message = result.text.trim();
    if (!message) return { sent: false, reason: 'empty briefing produced' };
    // Model judged the data unusable: stay silent so the 7:00 fallback retries
    // with fresh data, instead of delivering a junk one-liner as the briefing.
    if (isSentinel(message, 'STALE')) {
      return { sent: false, reason: 'model judged data stale' };
    }
    return { sent: true, message };
  } catch (err: any) {
    logger.error({ err }, 'Morning ritual failed');
    return { sent: false, reason: `ritual error: ${err?.message ?? err}` };
  }
}
