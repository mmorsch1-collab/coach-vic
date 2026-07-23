import { describe, it, expect } from 'vitest';
import { todayStr, hourInTz, isFresh, localDateTime, calendarWeek, weekdayLabel, weekdayOf } from '../src/util/time.js';
import {
  hardSetsInRange,
  hrvDropStreak,
  strainPattern,
  regressingLifts,
  muscleRetentionAlarm,
  type SetLog,
  type WhoopRow,
} from '../src/coaching/metrics.js';
import { recoveryColor, midMorningOpportunity, eveningConcern } from '../src/scheduler/gating.js';
import type { WhoopAssessment } from '../src/scheduler/gating.js';
import { retrieveContext } from '../src/memory/retrieval.js';

describe('time helpers', () => {
  it('todayStr is YYYY-MM-DD', () => {
    expect(todayStr('America/New_York')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('hourInTz is 0..23', () => {
    const h = hourInTz('America/New_York');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(24);
  });
  it('isFresh: recent true, old false, missing false', () => {
    expect(isFresh(new Date().toISOString(), 2)).toBe(true);
    expect(isFresh(new Date(Date.now() - 5 * 3600_000).toISOString(), 2)).toBe(false);
    expect(isFresh(undefined, 2)).toBe(false);
  });
  it('localDateTime builds a calendar-friendly local datetime', () => {
    expect(localDateTime('2026-06-09', '05:30')).toBe('2026-06-09T05:30:00');
  });
});

describe('recovery classification', () => {
  it('bands', () => {
    expect(recoveryColor(80)).toBe('green');
    expect(recoveryColor(50)).toBe('yellow');
    expect(recoveryColor(20)).toBe('red');
    expect(recoveryColor(null)).toBe('unknown');
  });
});

function assess(partial: Partial<WhoopAssessment>): WhoopAssessment {
  return {
    ok: true,
    authError: false,
    fresh: true,
    color: 'green',
    recovery: 80,
    strain: 2,
    ...partial,
  };
}

describe('coachable-moment gating', () => {
  it('mid-morning fires on green + low strain', () => {
    expect(midMorningOpportunity(assess({ color: 'green', strain: 2 }))).toBeTruthy();
  });
  it('mid-morning silent when not fresh', () => {
    expect(midMorningOpportunity(assess({ fresh: false }))).toBeNull();
  });
  it('mid-morning silent on yellow', () => {
    expect(midMorningOpportunity(assess({ color: 'yellow', recovery: 50 }))).toBeNull();
  });
  it('evening concern fires on very high strain', () => {
    expect(eveningConcern(assess({ strain: 16 }))).toBeTruthy();
    expect(eveningConcern(assess({ strain: 8 }))).toBeNull();
  });
});

describe('RAG retrieval (keyword)', () => {
  it('finds equipment context from the ported databases', async () => {
    const r = await retrieveContext('what dumbbell equipment does Matt have', 5);
    expect(r.entries.length).toBeGreaterThan(0);
    expect(r.rendered.toLowerCase()).toContain('dumbbell');
  });
  it('returns empty for a no-match query', async () => {
    const r = await retrieveContext('xyzzy zzz', 5);
    expect(r.entries.length).toBe(0);
  });
});

// ---- Calendar-week volume scoping (Mon–Sun, America/New_York) ----
describe('calendar week', () => {
  const TZ = 'America/New_York';
  const at = (d: string) => new Date(`${d}T12:00:00Z`); // 8am ET — same calendar date

  it('Monday opens the week', () => {
    expect(calendarWeek(TZ, at('2026-07-20'))).toEqual({ start: '2026-07-20', end: '2026-07-26' });
  });
  it('midweek maps back to its Monday', () => {
    expect(calendarWeek(TZ, at('2026-07-23'))).toEqual({ start: '2026-07-20', end: '2026-07-26' });
  });
  it('Sunday CLOSES the week it started in — it does not open a new one', () => {
    expect(calendarWeek(TZ, at('2026-07-26'))).toEqual({ start: '2026-07-20', end: '2026-07-26' });
    // The Sunday before belongs to the PRIOR week.
    expect(calendarWeek(TZ, at('2026-07-19')).start).toBe('2026-07-13');
  });
  it('the next Monday starts a fresh week (counts reset)', () => {
    expect(calendarWeek(TZ, at('2026-07-27')).start).toBe('2026-07-27');
  });
  it('weekday helpers read the DATE, not a label', () => {
    expect(weekdayLabel('2026-07-20')).toBe('Mon');
    expect(weekdayLabel('2026-07-26')).toBe('Sun');
    expect(weekdayOf('2026-07-23')).toBe(4); // Thu
  });
});

describe('hardSetsInRange (calendar-week volume)', () => {
  const log = (date: string, exercise: string, reps: number[]): SetLog => ({
    date, session: '', exercise, weight: 100, reps,
  });
  // Fri of the PREVIOUS week + Mon/Thu of the current week.
  const logs = [
    log('2026-07-17', 'Bench Press', [8, 8, 8]), // prior week — must NOT count
    log('2026-07-20', 'Bench Press', [8, 8, 8]),
    log('2026-07-23', 'Incline DB Press', [10, 10]),
  ];

  it('excludes the previous week — the rolling-window bug', () => {
    const wk = hardSetsInRange(logs, '2026-07-20', '2026-07-26');
    expect(wk.chest).toBe(5); // 3 Mon + 2 Thu; the Jul 17 sets are out of scope
  });
  it('counts a session by its logged date even when the weekday is unexpected', () => {
    // A "Monday chest" session actually trained (and dated) Sunday closes the
    // prior week — it must not leak into the new week's count.
    const sunday = [log('2026-07-26', 'Bench Press', [8, 8, 8])];
    expect(hardSetsInRange(sunday, '2026-07-20', '2026-07-26').chest).toBe(3);
    expect(hardSetsInRange(sunday, '2026-07-27', '2026-08-02').chest).toBeUndefined();
  });
  it('ignores sub-5-rep sets (warmups)', () => {
    expect(hardSetsInRange([log('2026-07-20', 'Bench Press', [3, 4])], '2026-07-20', '2026-07-26').chest)
      .toBeUndefined();
  });
});

// ---- WHOOP signals ----
describe('hrvDropStreak', () => {
  const rows = (hrvs: number[]): WhoopRow[] =>
    hrvs.map((hrv, i) => ({
      date: `2026-07-${String(26 - i).padStart(2, '0')}`,
      recovery: 60, hrv, rhr: 50, sleepHours: 7, strain: 12,
    }));

  it('flags a sustained >10% drop', () => {
    // 7 recent days at 50, 14 prior days at 70 → ~29% down, sustained.
    const r = hrvDropStreak(rows([...Array(10).fill(50), ...Array(14).fill(70)]));
    expect(r.days).toBeGreaterThanOrEqual(3);
    expect(r.dropPct).toBeGreaterThan(10);
  });
  it('stays silent on a flat series', () => {
    expect(hrvDropStreak(rows(Array(24).fill(60))).days).toBe(0);
  });
  it('needs 14 days of history before claiming anything', () => {
    expect(hrvDropStreak(rows([40, 40, 40])).days).toBe(0);
  });
});

describe('strainPattern (workout days only)', () => {
  const rows = (strains: number[]): WhoopRow[] =>
    strains.map((strain, i) => ({
      date: `2026-07-${String(26 - i).padStart(2, '0')}`,
      recovery: 60, hrv: 60, rhr: 50, sleepHours: 7, strain,
    }));
  const dates = (n: number) =>
    new Set(Array.from({ length: n }, (_, i) => `2026-07-${String(26 - i).padStart(2, '0')}`));

  it('flags recovery debt on repeated >16 days', () => {
    expect(strainPattern(rows([18, 17, 12, 12]), dates(4)).flag).toBe('recovery_debt');
  });
  it('flags undertrained when most workout days are <10', () => {
    expect(strainPattern(rows([8, 8, 9, 13]), dates(4)).flag).toBe('undertrained');
  });
  it('says nothing in the 12–15 target band', () => {
    expect(strainPattern(rows([13, 14, 12, 13]), dates(4)).flag).toBeNull();
  });
  it('ignores rest-day strain entirely', () => {
    expect(strainPattern(rows([18, 17, 18]), new Set<string>()).workoutDays).toBe(0);
  });
});

// ---- Muscle-retention alarm: ALL THREE or nothing ----
describe('muscleRetentionAlarm', () => {
  const full = { regressing: ['Bench Press', 'Row'], muscleMassSlope: -0.4, weightSlope: -0.6 };

  it('fires only when all three conditions hold', () => {
    expect(muscleRetentionAlarm(full).firing).toBe(true);
  });
  it('does NOT fire on lifts + muscle mass alone (weight flat)', () => {
    expect(muscleRetentionAlarm({ ...full, weightSlope: 0 }).firing).toBe(false);
  });
  it('does NOT fire on one regressing lift', () => {
    expect(muscleRetentionAlarm({ ...full, regressing: ['Bench Press'] }).firing).toBe(false);
  });
  it('does NOT fire when muscle mass is unknown', () => {
    expect(muscleRetentionAlarm({ ...full, muscleMassSlope: NaN }).firing).toBe(false);
  });
  it('reports what is missing so a partial signal reads as a watch item', () => {
    const r = muscleRetentionAlarm({ ...full, weightSlope: 0 });
    expect(r.met.length).toBe(2);
    expect(r.missing).toContain('weight dropping');
  });
});

describe('regressingLifts', () => {
  const s = (date: string, weight: number): SetLog => ({
    date, session: '', exercise: 'Bench Press', weight, reps: [8],
  });
  it('needs 2+ consecutive declining sessions', () => {
    const declining = [s('2026-07-06', 140), s('2026-07-13', 130), s('2026-07-20', 120)];
    expect(regressingLifts(declining, ['Bench Press'])).toEqual(['Bench Press']);
  });
  it('treats one off session as noise', () => {
    const dip = [s('2026-07-06', 130), s('2026-07-13', 120), s('2026-07-20', 140)];
    expect(regressingLifts(dip, ['Bench Press'])).toEqual([]);
  });
});
