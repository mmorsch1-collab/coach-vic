import { runTurn } from '../llm/agent.js';
import { logger } from '../logger.js';
import { isSkip } from './sentinel.js';
import type { CheckinResult } from './checkins.js';
import { bodyCompReviewStatus, completeBodyCompReview } from '../coaching/bodyCompReview.js';

/**
 * Sunday weekly review — a short progress check-in. Matt only wants BF%, muscle
 * retention/growth, strength gains (if any), and a recommendation for the coming
 * week — no weight, no workout/PR detail, no data dump (2026-08-02).
 */
export async function runWeeklyReview(): Promise<CheckinResult> {
  const instruction = [
    `Weekly progress check-in for Matt (Sunday). Call get_bodycomp_trend for BF%/muscle-mass`,
    `week-over-week averages (use the averages, not a single reading — they're the noise-smoothed`,
    `numbers) and get_exercise_progression for his key lifts to see if any e1RM moved.`,
    ``,
    `Write 2–3 short sentences covering exactly this, nothing else:`,
    `1. BF% trend (this week's avg vs last week's avg).`,
    `2. Muscle mass: retained, growing, or dropping (this week's avg vs last week's avg).`,
    `3. Strength: only mention if a key lift's e1RM actually moved — skip entirely if flat.`,
    `4. One concrete insight or recommendation for the coming week.`,
    ``,
    `No weight, no workout/session detail, no PR play-by-play, no data dump, no visible reasoning.`,
    `Coach voice — grounded and brief. If there's nothing worth reporting, reply exactly "SKIP".`,
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
      retrievalQuery: 'weekly review body fat muscle mass strength progress',
      tier: 'heavy',
      maxTokens: 400,
      maxIterations: 8,
    });
    const message = r.text.trim();
    if (isSkip(message)) return { sent: false, reason: 'nothing worth a review' };
    return { sent: true, message, onDelivered: review.due ? () => completeBodyCompReview() : undefined };
  } catch (err: any) {
    logger.error({ err }, 'Weekly review failed');
    return { sent: false, reason: `error: ${err?.message ?? err}` };
  }
}
