import { describe, it, expect } from 'vitest';
import { planWhoopSync, localDateOf, type ApiWhoopRow } from '../src/scheduler/whoopSync.js';

const TZ = 'America/New_York';
const H = ['Date', 'Recovery', 'HRV', 'Resting HR', 'Sleep Hours', 'Sleep Score', 'Strain', 'Skin Temp'];
const api = (date: string, strain: number, final: boolean, createdAt = `${date}T11:00:00Z`): ApiWhoopRow => ({
  date, createdAt, recovery: 60, hrv: 60, restingHeartRate: 50, sleepHours: 7, sleepScore: 80, strain, skinTemp: 95, final,
});

describe('planWhoopSync (end-of-day strain capture)', () => {
  it('overwrites a wake-time strain with the closed-cycle total once the cycle is final', () => {
    const sheet = [H, ['2026-10-13', 83, 73, 50, 6.9, 84, 0.3, 94]];
    const p = planWhoopSync(sheet, [api('2026-10-13', 13.8, true)], TZ);
    expect(p.updates).toEqual([{ date: '2026-10-13', rowNum: 2, from: 0.3, to: 13.8, final: true }]);
    expect(p.appends).toEqual([]);
  });
  it('on an OPEN cycle only raises strain (it accumulates), never lowers it', () => {
    const sheet = [H, ['2026-10-16', 70, 60, 50, 7, 80, 9.5, 95]];
    expect(planWhoopSync(sheet, [api('2026-10-16', 4.2, false)], TZ).updates).toEqual([]);
    expect(planWhoopSync(sheet, [api('2026-10-16', 11.0, false)], TZ).updates[0]?.to).toBe(11);
  });
  it('a final value corrects in either direction', () => {
    const sheet = [H, ['2026-10-13', 83, 73, 50, 6.9, 84, 15, 94]];
    expect(planWhoopSync(sheet, [api('2026-10-13', 12.1, true)], TZ).updates[0]?.to).toBe(12.1);
  });
  it('appends only dates WHOOP actually scored — no stale copies for unscored days', () => {
    const p = planWhoopSync([H], [api('2026-10-09', 2.66, true), api('2026-10-13', 3.64, false)], TZ);
    expect(p.appends.map((a) => a.date)).toEqual(['2026-10-09', '2026-10-13']);
  });
  it('is idempotent: an unchanged final value plans nothing', () => {
    const sheet = [H, ['2026-10-13', 83, 73, 50, 6.9, 84, 13.8, 94]];
    expect(planWhoopSync(sheet, [api('2026-10-13', 13.8, true)], TZ)).toEqual({ appends: [], updates: [] });
  });
  it('keys rows by the LOCAL scored date, not the bridge UTC date', () => {
    // Scored 10:30 PM ET Oct 15 = Oct 16 UTC.
    expect(localDateOf(api('2026-10-16', 1, false, '2026-10-16T02:30:00Z'), TZ)).toBe('2026-10-15');
  });
  it('updates the first occurrence when the sheet already has duplicate dates', () => {
    const sheet = [H, ['2026-06-09', 1, 1, 1, 1, 1, 0.07, 1], ['2026-06-09', 1, 1, 1, 1, 1, 0.07, 1]];
    expect(planWhoopSync(sheet, [api('2026-06-09', 12, true)], TZ).updates).toHaveLength(1);
  });
});
