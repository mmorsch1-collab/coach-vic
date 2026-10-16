import { JsonStore } from '../state/jsonStore.js';
import { config } from '../config.js';
import { daysBetween, todayStr } from '../util/time.js';
import { logger } from '../logger.js';

/**
 * The 4-weekly formal body-comp review (GOAL.md Miami timeline).
 *
 * WHY (2026-10-16): the snapshot raised "MONTHLY BODY COMP REVIEW DUE" whenever
 * `weeksIn % 4 === 0`, i.e. on EVERY turn for a whole week, and never knew the
 * review had already happened. Now it is a state machine over 4-week windows:
 *   window n = floor(daysSinceAnchor / 28); due ⇔ n >= 1 AND n > lastCompletedWindow.
 * It is due once per window and clears the moment a review is delivered
 * (automatically after the Sunday weekly review, or via the
 * complete_bodycomp_review tool when it is done in chat).
 */

/** Miami-goal timeline anchor (GOAL.md). */
export const MIAMI_ANCHOR = '2026-07-18';
const WINDOW_DAYS = 28;

interface ReviewState {
  lastCompletedWindow: number;
  completedOn?: string;
}
const store = new JsonStore<ReviewState>('bodycomp-review-state.json', { lastCompletedWindow: 0 });

export function reviewWindow(today: string, anchor = MIAMI_ANCHOR): number {
  const d = daysBetween(anchor, today);
  return Number.isFinite(d) && d >= 0 ? Math.floor(d / WINDOW_DAYS) : 0;
}

/** Pure: is a review due for `today` given the last completed window? */
export function isReviewDue(today: string, lastCompletedWindow: number, anchor = MIAMI_ANCHOR): boolean {
  const w = reviewWindow(today, anchor);
  return w >= 1 && w > lastCompletedWindow;
}

export async function bodyCompReviewStatus(today = todayStr(config.tz)): Promise<{ due: boolean; window: number; weeksIn: number }> {
  const st = await store.read();
  const window = reviewWindow(today);
  return { due: isReviewDue(today, st.lastCompletedWindow), window, weeksIn: Math.floor(daysBetween(MIAMI_ANCHOR, today) / 7) };
}

/** Mark the current window's review done (idempotent). */
export async function completeBodyCompReview(today = todayStr(config.tz)): Promise<number> {
  const window = reviewWindow(today);
  await store.update((s) => {
    if (window > s.lastCompletedWindow) {
      s.lastCompletedWindow = window;
      s.completedOn = today;
    }
  });
  logger.info({ window, today }, 'Body-comp review marked complete');
  return window;
}
