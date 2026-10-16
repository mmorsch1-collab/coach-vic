import { describe, it, expect } from 'vitest';
import {
  parseWorkoutDb,
  exerciseSeries,
  hardSetsInRange,
  bestE1rmBefore,
  parseSetDetail,
  formatSetDetail,
  topSet,
  volumeLoad,
  e1rm,
} from '../src/coaching/metrics.js';
import { buildDbRow } from '../src/coaching/workoutIngest.js';
import { checkSheetAgainstPlan, planFromExercises } from '../src/coaching/workoutPlan.js';
import { doneTruthy } from '../src/coaching/workoutIngest.js';

const HEADER = ['Date', 'Session', 'Exercise', 'Weight_lbs', 'Set_1', 'Set_2', 'Set_3', 'Notes', 'RIR', 'e1RM', 'Set_4', 'Set_5', 'Set_6', 'Set_Detail'];
const db = (...rows: (string | number)[][]) => [HEADER, ...rows];

describe('per-set weight & reps (item 15)', () => {
  it('drop set: every set keeps its own weight, all count as hard sets', () => {
    const row = buildDbRow({
      date: '2026-10-14', exercise: 'Incline DB Press',
      sets: [{ weight: 50, reps: 10 }, { weight: 40, reps: 10 }, { weight: 30, reps: 12 }],
    });
    const [log] = parseWorkoutDb(db(row));
    expect(log.sets).toEqual([{ weight: 50, reps: 10 }, { weight: 40, reps: 10 }, { weight: 30, reps: 12 }]);
    expect(hardSetsInRange([log], '2026-10-13', '2026-10-19').chest).toBe(3);
    const s = exerciseSeries([log], 'Incline DB Press')[0];
    expect(s.weight).toBe(50); // top set is the 50×10, not the 30×12
    expect(s.topReps).toBe(10);
    expect(s.volume).toBe(50 * 10 + 40 * 10 + 30 * 12);
    expect(s.setCount).toBe(3);
  });

  it('ramp-up: the top set is the heaviest e1RM, and weight/reps come from the SAME set', () => {
    // 135×8, 155×6, 175×3: never pair 175 with 8 reps.
    const sets = [{ weight: 135, reps: 8 }, { weight: 155, reps: 6 }, { weight: 175, reps: 3 }];
    const t = topSet(sets)!;
    expect(t.set).toEqual({ weight: 175, reps: 3 });
    expect(t.e1rm).toBeCloseTo(e1rm(175, 3), 5);
    const row = buildDbRow({ date: '2026-10-14', exercise: 'Bench Press', sets });
    expect(row[3]).toBe(175); // Weight_lbs = top-set weight
    expect(row[9]).toBe(Math.round(e1rm(175, 3) * 10) / 10);
    expect(row[13]).toBe('135x8; 155x6; 175x3');
  });

  it('mixed sequence incl. bodyweight round-trips through Set_Detail', () => {
    const sets = [{ weight: 0, reps: 12 }, { weight: 25, reps: 8 }, { weight: 0, reps: 10 }];
    expect(formatSetDetail(sets)).toBe('BWx12; 25x8; BWx10');
    expect(parseSetDetail('BWx12; 25x8; BWx10')).toEqual(sets);
    const [log] = parseWorkoutDb(db(buildDbRow({ date: '2026-10-14', exercise: 'Tricep Dip', sets })));
    expect(log.sets).toEqual(sets);
    expect(hardSetsInRange([log], '2026-10-13', '2026-10-19').triceps).toBe(3);
  });

  it('keeps more than six sets (old columns stopped at Set_6)', () => {
    const sets = Array.from({ length: 8 }, (_, i) => ({ weight: 100 - i * 5, reps: 10 }));
    const [log] = parseWorkoutDb(db(buildDbRow({ date: '2026-10-14', exercise: 'Leg Press', sets })));
    expect(log.sets).toHaveLength(8);
    expect(hardSetsInRange([log], '2026-10-13', '2026-10-19').legs).toBe(8);
  });

  it('legacy rows: off-weight sets parked in Notes ("also: …") are recovered', () => {
    // How the old ingest wrote a 185×6 + 175×8 session: working weight 185, the 175 set in notes.
    const legacy = ['2026-10-09', '', 'Bench Press', 185, 6, '', '', 'also: 175x8, 165x10', '', 215, '', '', ''];
    const [log] = parseWorkoutDb([HEADER.slice(0, 13), legacy]);
    expect(log.sets).toEqual([{ weight: 185, reps: 6 }, { weight: 175, reps: 8 }, { weight: 165, reps: 10 }]);
    expect(hardSetsInRange([log], '2026-10-06', '2026-10-12').chest).toBe(3); // was 1
    expect(volumeLoad(log.sets)).toBe(185 * 6 + 175 * 8 + 165 * 10);
  });

  it('legacy rows without notes still read as one weight × Set_N reps', () => {
    const [log] = parseWorkoutDb([HEADER.slice(0, 13), ['2026-10-09', '', 'Incline DB Press', 50, 10, 10, 10, '', '', 66.7]]);
    expect(log.sets).toEqual([{ weight: 50, reps: 10 }, { weight: 50, reps: 10 }, { weight: 50, reps: 10 }]);
  });

  it('PR detection uses the best per-set e1RM across all sets', () => {
    const logs = parseWorkoutDb(db(
      buildDbRow({ date: '2026-10-01', exercise: 'Bench Press', sets: [{ weight: 135, reps: 10 }, { weight: 185, reps: 3 }] }),
    ));
    expect(bestE1rmBefore(logs, 'Bench Press', '2026-10-02')).toBe(Math.round(e1rm(185, 3) * 10) / 10);
  });
});

describe('sheet vs plan check (item 15)', () => {
  const plan = planFromExercises([
    { name: 'Incline DB Press', sets: 3, targetReps: 10, targetWeight: '50' },
    { name: 'Pull-up', sets: 2, targetReps: 8, targetWeight: 'BW' },
  ]);
  const sheet = (rows: Array<[string, number, string, string, string]>) => {
    const byEx = new Map<string, any>();
    for (const [name, set, weight, reps, done] of rows) {
      if (!byEx.has(name)) byEx.set(name, { name, sets: [] });
      byEx.get(name).sets.push({ set, weight, reps, done });
    }
    return [...byEx.values()];
  };

  it('silent when everything was executed as planned', () => {
    const w = sheet([
      ['Incline DB Press', 1, '50', '10', 'TRUE'], ['Incline DB Press', 2, '50', '10', 'TRUE'],
      ['Incline DB Press', 3, '50', '10', 'TRUE'], ['Pull-up', 1, 'BW', '8', 'TRUE'], ['Pull-up', 2, 'BW', '8', 'TRUE'],
    ]);
    expect(checkSheetAgainstPlan(w, plan, doneTruthy)).toEqual([]);
  });
  it('an untouched, unticked (skipped) set is NOT flagged', () => {
    const w = sheet([['Incline DB Press', 1, '50', '10', 'TRUE'], ['Incline DB Press', 3, '50', '10', 'FALSE']]);
    expect(checkSheetAgainstPlan(w, plan, doneTruthy)).toEqual([]);
  });
  it('flags rows filled in (edited) but not checked', () => {
    const w = sheet([['Incline DB Press', 3, '40', '12', 'FALSE']]);
    const out = checkSheetAgainstPlan(w, plan, doneTruthy);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/FILLED BUT NOT CHECKED/);
    expect(out[0]).toMatch(/Incline DB Press set 3/);
  });
  it('flags checked rows that differ from the plan (drop set / deviation)', () => {
    const w = sheet([['Incline DB Press', 3, '40', '12', 'TRUE'], ['Pull-up', 2, 'BW', '6', 'TRUE']]);
    const out = checkSheetAgainstPlan(w, plan, doneTruthy);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/CHECKED BUT DIFFERS FROM PLAN \(2\)/);
  });
  it('no stored plan → no warnings (cannot judge an untracked sheet)', () => {
    expect(checkSheetAgainstPlan(sheet([['Incline DB Press', 1, '40', '12', 'FALSE']]), null, doneTruthy)).toEqual([]);
  });
});
