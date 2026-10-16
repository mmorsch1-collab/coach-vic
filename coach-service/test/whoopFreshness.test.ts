import { describe, it, expect } from 'vitest';
import { assessFreshness, gateWhoopToday, STALE_LABEL } from '../src/coaching/whoopFreshness.js';

const TZ = 'America/New_York';
const NOW = new Date('2026-10-16T13:00:00Z'); // 9:00 AM ET, Fri Oct 16
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const meta = (h: number, state = 'SCORED') => ({ created_at: hoursAgo(h), updated_at: hoursAgo(h), score_state: state });

const payload = (h: number, state = 'SCORED') => ({
  date: '2026-10-16', // the bridge always stamps "now" here — must NOT be trusted
  recovery: { score: 71, hrv: 88, restingHeartRate: 49, metadata: meta(h, state) },
  sleep: { durationHours: 7.4, sleepScore: 90 },
  strain: { score: 3.1 },
});

describe('WHOOP freshness gate (regression: "SCORED, 78.8h old" shown as today)', () => {
  it('rejects a 78.8h-old SCORED recovery in BOTH modes', () => {
    for (const mode of ['ritual', 'checkin'] as const) {
      const f = assessFreshness(meta(78.8), mode, TZ, NOW);
      expect(f.usable).toBe(false);
      expect(f.label.startsWith(STALE_LABEL)).toBe(true);
    }
  });
  it('gateWhoopToday withholds every number from stale data and labels it', () => {
    const g = gateWhoopToday(payload(78.8), 'checkin', TZ, NOW) as any;
    expect(g.stale).toBe(true);
    expect(g.status).toBe('stale, do not coach on it');
    const text = JSON.stringify(g);
    expect(text).not.toContain('"score":71');
    expect(text).not.toContain('"hrv":88');
    expect(g.recovery).toBeUndefined();
    expect(g.sleep).toBeUndefined();
  });
  it('ignores the bridge "date" field (it is the request time, not the score date)', () => {
    const g = gateWhoopToday(payload(30), 'checkin', TZ, NOW) as any;
    expect(g.stale).toBe(true);
  });
});

describe('ritual mode (morning briefing): SCORED and <= 2h', () => {
  it('accepts 1.5h, rejects 2.5h', () => {
    expect(assessFreshness(meta(1.5), 'ritual', TZ, NOW).usable).toBe(true);
    expect(assessFreshness(meta(2.5), 'ritual', TZ, NOW).usable).toBe(false);
  });
  it('rejects anything not SCORED, even if brand new', () => {
    const f = assessFreshness(meta(0.2, 'PENDING_SCORE'), 'ritual', TZ, NOW);
    expect(f.usable).toBe(false);
    expect(f.label).toMatch(/not SCORED/);
  });
  it('rejects a missing timestamp', () => {
    expect(assessFreshness({ score_state: 'SCORED' }, 'ritual', TZ, NOW).usable).toBe(false);
  });
});

describe('checkin mode: SCORED today (local tz)', () => {
  it('accepts a recovery scored this morning, many hours later', () => {
    const evening = new Date('2026-10-17T00:30:00Z'); // 8:30 PM ET Oct 16
    const scoredAt = '2026-10-16T10:45:00Z'; // 6:45 AM ET Oct 16
    const f = assessFreshness({ created_at: scoredAt, updated_at: scoredAt, score_state: 'SCORED' }, 'checkin', TZ, evening);
    expect(f.usable).toBe(true);
    expect(f.scoredDate).toBe('2026-10-16');
  });
  it('rejects yesterday\'s score even when it is < 18h old (the old window let this through)', () => {
    const scoredAt = '2026-10-15T23:30:00Z'; // 7:30 PM ET Oct 15 (a late nap re-score)
    const f = assessFreshness({ created_at: scoredAt, updated_at: scoredAt, score_state: 'SCORED' }, 'checkin', TZ, NOW);
    expect(f.usable).toBe(false);
    expect(f.label).toMatch(/not today/);
  });
  it('fresh payload passes through with the REAL scored date and a freshness block', () => {
    const g = gateWhoopToday(payload(2.2), 'checkin', TZ, NOW) as any;
    expect(g.stale).toBeUndefined();
    expect(g.recovery.score).toBe(71);
    expect(g.freshness.status).toBe('fresh');
    expect(g.date).toBe('2026-10-16');
  });
});
