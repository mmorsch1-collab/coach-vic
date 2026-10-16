import { runTurn } from '../llm/agent.js';
import { logger } from '../logger.js';
import { isSkip } from './sentinel.js';
import type { CheckinResult } from './checkins.js';
import { bodyCompReviewStatus, completeBodyCompReview } from '../coaching/bodyCompReview.js';
import { addDaysStr, todayStr } from '../util/time.js';
import { config } from '../config.js';

/**
 * Sunday weekly review — the one data-rich coaching message of the week. Pulls
 * the computed trends and produces progress + 1–2 concrete adjustments + the
 * detections (plateau, too-fast loss, muscle-loss, low adherence).
 */
export async function runWeeklyReview(): Promise<CheckinResult> {
  const today = todayStr(config.tz);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysStr(today, -(7 - i))); // Sun..Sat

  const instruction = [
    `Weekly review for Matt (Sunday). You have the COACHING SNAPSHOT in context. Use tools as needed:`,
    `get_muscle_volume (weekly hard sets vs landmarks), get_bodycomp_trend (weight/BF% slope),`,
    `get_whoop_history (recovery trend), get_exercise_progression for any key lift, get_goals.`,
    ``,
    `This week's daily logs exist for: ${weekDates.join(', ')}. Use recall_day on the 2-3 days that`,
    `matter (training days, days Matt raised something) — or search_memory — so the review reflects`,
    `what actually happened and was SAID this week, not just the numbers. Watch for [pr] lines`,
    `(new e1RM PRs) and call them out by name.`,
    ``,
    `Assess and report concisely (this is the week's one data-rich message):`,
    `1. Training: which lifts progressed (e1RM), which stalled (flag a plateau if e1RM flat 3+ sessions),`,
    `   and whether weekly volume per muscle is in range (esp. chest ~10–16, legs maintenance).`,
    `2. Body comp vs the cut rate (~0.5%/wk): on-track / too fast (>1%/wk → muscle risk, ease deficit) /`,
    `   stalled (tighten or add a diet break). Check the strength-retention guardrail: e1RM trend vs`,
    `   weight trend — if strength is falling while weight drops, flag muscle loss → eat more / end cut.`,
    `3. Recovery + adherence: sessions vs target, recovery trend, sleep.`,
    ``,
    `Then write the message: 2–3 sentences of what's working (encourage with specifics), then 1–2`,
    `concrete adjustments for next week, then one question. Coach voice — grounded, no data dump,`,
    `no visible reasoning. If there's genuinely nothing worth a weekly message, reply exactly "SKIP".`,
  ].join('\n');

  // Monthly body-comp review: folded into the weekly review ONCE per 4-week window,
  // and cleared only after the message is actually delivered (bodyCompReview.ts).
  const review = await bodyCompReviewStatus().catch(() => ({ due: false, window: 0, weeksIn: 0 }));
  const prompt = review.due
    ? instruction +
      '\n\nThis week also closes a 4-week body-comp window: add ONE sentence on whether the BF% trend ' +
      'is on pace for the ~0.3–0.5% BF/month target toward the Dec 29 date (use the cleaned averages).'
    : instruction;

  try {
    const r = await runTurn({
      messages: [{ role: 'user', content: prompt }],
      sessionType: 'isolated',
      retrievalQuery: 'weekly review progress plateau cut rate recovery adherence',
      tier: 'heavy',
      maxTokens: 1200,
      maxIterations: 12,
    });
    const message = r.text.trim();
    if (isSkip(message)) return { sent: false, reason: 'nothing worth a review' };
    return { sent: true, message, onDelivered: review.due ? () => completeBodyCompReview() : undefined };
  } catch (err: any) {
    logger.error({ err }, 'Weekly review failed');
    return { sent: false, reason: `error: ${err?.message ?? err}` };
  }
}
