import { describe, it, expect } from 'vitest';
import { lintProactive, finalizeProactive, countNumbers } from '../src/delivery/lint.js';

const GOOD_NUDGE = "Get a 20-minute walk in before your 2pm block — you've been at the desk since 9. Easy pace is plenty.";
const GOOD_BRIEFING =
  "Chest day — keep every planned set and cap effort at RIR 1–2. The sheet's built " +
  '(https://docs.google.com/spreadsheets/d/abc123/edit#gid=456) and your 9:30 block is on the calendar. ' +
  "How's the left hip feeling this morning?";

describe('pre-send lint: passes clean coaching messages', () => {
  it('accepts a short recommendation-first nudge', () => {
    expect(lintProactive(GOOD_NUDGE)).toEqual({ ok: true, violations: [] });
  });
  it('accepts a briefing with a sheet URL and clock time (not counted as data)', () => {
    expect(lintProactive(GOOD_BRIEFING, { maxChars: 1200, maxNumbers: 12 }).ok).toBe(true);
  });
  it('countNumbers ignores URLs and clock times', () => {
    expect(countNumbers('at 9:30 see https://x.com/a/123456 then 3 sets')).toBe(1);
  });
});

describe('pre-send lint: rejects working, corrections and dumps', () => {
  const cases: Array<[string, RegExp]> = [
    ['Let me recalculate: your 21d slope was anchored on the Sept highs, so I was wrong earlier.', /working language|correcting/],
    ['Correction: my previous number was off — muscle is flat, not down.', /correcting an earlier error/],
    ['147.7 - 146.2 = 1.5 lb, so the rate is fine. Keep going.', /shows a calculation/],
    ['Looking at your data, recovery is 71% and HRV 88ms. Train hard.', /narrating|does not lead/],
    ["Here's the update: BF 10.5%, muscle 125.9, weight 148.1, slope -0.1, HRV 88, RHR 49, sleep 7.4, strain 3.1, recovery 71.", /does not lead|too many numbers/],
    ['Based on the snapshot, get_bodycomp_trend shows a flat trend.', /internal|narrating/],
  ];
  for (const [msg, want] of cases) {
    it(msg.slice(0, 50), () => {
      const r = lintProactive(msg);
      expect(r.ok).toBe(false);
      expect(r.violations.join(' | ')).toMatch(want);
    });
  }
  it('rejects a long data dump by length', () => {
    expect(lintProactive('Keep the plan steady this week. ' + 'More detail here. '.repeat(60)).violations.join()).toMatch(/too long/);
  });
});

describe('pre-send lint: GOAL.md hands-off protein rule', () => {
  for (const msg of [
    'What did you eat for lunch? Want to make sure you are on track.',
    "How's protein looking today?",
    'Quick one: you have 60g to go — want to grab a shake?',
    'Log your meals when you get a sec.',
  ]) {
    it(msg, () => expect(lintProactive(msg).violations.join()).toMatch(/solicits meals\/protein/));
  }
});

describe('finalizeProactive (one rewrite, else suppress)', () => {
  it('sends a clean draft untouched without calling the rewriter', async () => {
    let called = false;
    const out = await finalizeProactive('afternoon', GOOD_NUDGE, {}, async () => { called = true; return ''; });
    expect(out).toBe(GOOD_NUDGE);
    expect(called).toBe(false);
  });
  it('sends the rewrite when it passes', async () => {
    const out = await finalizeProactive('afternoon', 'Let me check: 3 x 12 = 36 reps.', {}, async () => GOOD_NUDGE);
    expect(out).toBe(GOOD_NUDGE);
  });
  it('suppresses when the rewrite still fails, says SKIP, or throws', async () => {
    expect(await finalizeProactive('x', 'Let me check.', {}, async () => 'Let me check again.')).toBeNull();
    expect(await finalizeProactive('x', 'Let me check.', {}, async () => 'SKIP')).toBeNull();
    expect(await finalizeProactive('x', 'Let me check.', {}, async () => { throw new Error('api'); })).toBeNull();
  });
});
