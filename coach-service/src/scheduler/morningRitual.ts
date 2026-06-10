import { runTurn } from '../llm/agent.js';
import { assessWhoop } from './gating.js';
import { todayStr, localDateTime } from '../util/time.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * The M–F 5:15 AM morning ritual:
 *   WHOOP (fresh?) → Withings → build recovery-appropriate workout sheet →
 *   create the 5:30 calendar block (with sheet link) → send a coach-voice briefing.
 *
 * If WHOOP isn't authenticated or the data is stale, stay silent (the 7:00
 * fallback retries) — unless `force` (manual test) is set.
 */

export interface RitualResult {
  sent: boolean;
  message?: string;
  reason?: string;
}

export async function runMorningRitual(opts: { force?: boolean } = {}): Promise<RitualResult> {
  const date = todayStr(config.tz);
  const a = await assessWhoop();

  if (!opts.force) {
    if (!a.ok) return { sent: false, reason: a.reason ?? 'WHOOP unavailable' };
    if (!a.fresh) return { sent: false, reason: `WHOOP not fresh: ${a.reason}` };
  }

  const workoutStart = localDateTime(date, '05:30');
  const workoutEnd = localDateTime(date, '06:30');

  const instruction = [
    `It is the weekday 5:15 AM morning ritual for ${date}. Produce Matt's morning briefing.`,
    ``,
    `Do this, using your tools:`,
    `1. You already have today's WHOOP via get_whoop_today — confirm recovery is fresh`,
    `   (metadata.updated_at within 2h AND score_state "SCORED"). If it is NOT fresh, do NOT`,
    `   fabricate coaching — return a single line saying data isn't current yet and stop.`,
    `2. Call get_withings_latest (and get_withings_history if useful) for body-comp context`,
    `   toward the ~10% body-fat recomposition goal.`,
    `3. Build a recovery-appropriate, goal-aligned workout per WORKOUT_PROTOCOL.md and create it`,
    `   with create_workout (date "${date}"). Capture the returned sheet URL.`,
    `4. Create the workout calendar block with create_calendar_event:`,
    `   title like "🏋️ Workout — <split>", startTime "${workoutStart}", endTime "${workoutEnd}",`,
    `   and put the sheet URL in the description.`,
    `5. Save today's WHOOP numbers with save_whoop_snapshot.`,
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
    return { sent: true, message };
  } catch (err: any) {
    logger.error({ err }, 'Morning ritual failed');
    return { sent: false, reason: `ritual error: ${err?.message ?? err}` };
  }
}
