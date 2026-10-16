import { describe, it, expect } from 'vitest';
import { isReviewDue, reviewWindow } from '../src/coaching/bodyCompReview.js';

describe('monthly body-comp review trigger (once per 4-week window)', () => {
  it('maps dates to 28-day windows from the Miami anchor', () => {
    expect(reviewWindow('2026-07-18')).toBe(0);
    expect(reviewWindow('2026-08-15')).toBe(1);
    expect(reviewWindow('2026-10-16')).toBe(3);
  });
  it('is not due before the first full window', () => {
    expect(isReviewDue('2026-08-14', 0)).toBe(false);
  });
  it('is due once a new window opens and stays due until completed (not tied to one week)', () => {
    expect(isReviewDue('2026-10-10', 2)).toBe(true);
    expect(isReviewDue('2026-10-20', 2)).toBe(true);
  });
  it('clears for the rest of the window once completed, and re-arms next window', () => {
    expect(isReviewDue('2026-10-16', 3)).toBe(false);
    expect(isReviewDue('2026-11-06', 3)).toBe(false);
    expect(isReviewDue('2026-11-07', 3)).toBe(true); // window 4 starts
  });
});
