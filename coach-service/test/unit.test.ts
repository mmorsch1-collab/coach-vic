import { describe, it, expect } from 'vitest';
import { todayStr, hourInTz, isFresh, localDateTime, calendarWeek, weekdayLabel, weekdayOf } from '../src/util/time.js';
import {
  hardSetsInRange,
  hrvDropStreak,
  strainPattern,
  regressingLifts,
  muscleRetentionAlarm,
  muscleOf,
  VOLUME_BANDS,
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
  // Dates must be RECENT: strainPattern windows by days, not by row count.
  const day = (i: number) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
  const rows = (strains: number[]): WhoopRow[] =>
    strains.map((strain, i) => ({
      date: day(i), recovery: 60, hrv: 60, rhr: 50, sleepHours: 7, strain,
    }));
  const dates = (n: number) => new Set(Array.from({ length: n }, (_, i) => day(i)));

  it('flags recovery debt on repeated >16 days (high readings are trustworthy)', () => {
    expect(strainPattern(rows([18, 17, 12, 12]), dates(4)).flag).toBe('recovery_debt');
  });
  it('says nothing in the 12–15 target band', () => {
    expect(strainPattern(rows([13, 14, 12, 13]), dates(4)).flag).toBeNull();
    expect(strainPattern(rows([13, 14, 12, 13]), dates(4)).lowConfidence).toBe(false);
  });
  it('does NOT cry undertrained on morning-captured strain — marks low confidence', () => {
    // Real observed WHOOP_History values: the morning job records strain-so-far.
    const r = strainPattern(rows([1.46, 0.07, 0.09, 4.8]), dates(4));
    expect(r.flag).toBeNull();
    expect(r.lowConfidence).toBe(true);
  });
  it('ignores rest-day strain entirely', () => {
    expect(strainPattern(rows([18, 17, 18]), new Set<string>()).workoutDays).toBe(0);
  });
  it('ignores records older than the window', () => {
    const stale = [{ date: '2026-01-01', recovery: 60, hrv: 60, rhr: 50, sleepHours: 7, strain: 18 }];
    expect(strainPattern(stale, new Set(['2026-01-01'])).workoutDays).toBe(0);
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

// ---- Exercise → muscle mapping ----
// Every case below is a REAL exercise name from WORKOUT_DATABASE that was
// previously misfiled. These are regression locks, not hypotheticals.
describe('muscleOf', () => {
  const cases: Array<[string, string]> = [
    // Was chest via `incline (db|…)` — 6 sessions of arm work as chest volume.
    ['Incline DB Curl', 'biceps'],
    ['Incline DB Curls', 'biceps'],
    // Was chest via `dip`.
    ['Tricep Dip', 'triceps'],
    // Was shoulders via `overhead`.
    ['Overhead Cable Tricep Extension', 'triceps'],
    ['Overhead Tricep Extension (cable or EZ-bar)', 'triceps'],
    // Was back via bare `chin` matching ma-CHIN-e.
    ['Ab Crunch machine', 'core'],
    ['Machine Fly', 'chest'],
    // Fell through to 'other' and vanished from every count.
    ['Face Pull', 'shoulders'],
    ['Flat DB Press', 'chest'],
    ['Hanging Leg Raise', 'core'],
    ['Pallof Press', 'core'],
    ['DB Pullovers', 'back'],
    ['Outer Thigh Machine', 'legs'],
    // Ordering guards that must not regress.
    ['Leg Curl', 'legs'],
    ['Calf Raise', 'legs'],
    ['DB Lateral Raise', 'shoulders'],
    ['Overhead Press', 'shoulders'],
    ['Incline DB Press (KEY LIFT)', 'chest'],
    ['Romanian Deadlift', 'legs'],
    ['Lat Pulldown', 'back'],
  ];
  for (const [name, want] of cases) {
    it(`${name} -> ${want}`, () => expect(muscleOf(name)).toBe(want));
  }

  it('classifies warm-up / ramp / prehab rows as warmup', () => {
    for (const w of [
      'Warm-Up: Quadruped Hip CARs',
      'Warm-Up: Plank Rocks',
      'Prone Press-Ups',
      'DB Shoulder Press Ramp 1',
      'Chin Retractions',
    ]) {
      expect(muscleOf(w)).toBe('warmup');
    }
  });

  it('never counts warm-up rows as hard sets', () => {
    const logs: SetLog[] = [
      { date: '2026-07-24', session: '', exercise: 'Warm-Up: Plank Rocks', weight: 0, reps: [10, 10] },
      { date: '2026-07-24', session: '', exercise: 'Hanging Leg Raise', weight: 0, reps: [12, 12] },
    ];
    const hs = hardSetsInRange(logs, '2026-07-20', '2026-07-26');
    expect(hs.core).toBe(2); // only the real work
    expect(hs.warmup).toBeUndefined();
  });
});

describe('VOLUME_BANDS matches WORKOUT_PROTOCOL.md', () => {
  // The locked "Weekly MAV Targets" table. Code and doc drifted apart once
  // (back MAV 16 vs 14, chest MEV 10 vs 8, core MEV 0 vs 4) — lock them.
  it('bands equal the protocol table', () => {
    expect(VOLUME_BANDS).toEqual({
      chest: { mev: 8, mav: 16, mrv: 20 },
      back: { mev: 10, mav: 14, mrv: 20 },
      shoulders: { mev: 8, mav: 14, mrv: 18 },
      biceps: { mev: 6, mav: 12, mrv: 16 },
      triceps: { mev: 6, mav: 12, mrv: 16 },
      legs: { mev: 6, mav: 10, mrv: 14 },
      core: { mev: 4, mav: 8, mrv: 12 },
    });
  });
});
