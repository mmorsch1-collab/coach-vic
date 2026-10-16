import { describe, it, expect } from 'vitest';
import {
  cleanReading,
  parseBodyCompSheet,
  weekOverWeek,
  cleanWithingsSummary,
  cleanWeightHistory,
  toNum,
  weightTrend,
  muscleSlope14,
  TARGET_LOSS_MIN,
  TARGET_LOSS_MAX,
} from '../src/coaching/bodyComp.js';

// Real BODY_COMPOSITION tail (2026-09-14 → 2026-10-15). 2026-10-08 is the failed
// impedance reading: weight present, BF% and muscle BLANK.
const HEADER = ['Date', 'Weight_lbs', 'Body_Fat_%', 'Muscle_Mass_lbs', 'Hydration_%', 'Visceral_Fat_Rating', 'Notes'];
const RAW: Array<[string, number, number | '', number | '']> = [
  ['2026-09-14', 151.2, 11.7, 126.8], ['2026-09-15', 150.1, 11.4, 126.4], ['2026-09-16', 150.6, 11.5, 126.6],
  ['2026-09-18', 149.8, 11.2, 126.3], ['2026-09-22', 150.6, 11.8, 126.2], ['2026-09-23', 149.2, 11.3, 125.7],
  ['2026-09-25', 149.6, 11.2, 126.1], ['2026-09-26', 150.7, 11.6, 126.5], ['2026-09-27', 149.7, 11.4, 125.9],
  ['2026-09-28', 151.5, '', ''], ['2026-09-29', 150.3, 11.3, 126.7], ['2026-09-30', 149.8, 11.3, 126.1],
  ['2026-10-01', 149.4, 11.4, 125.7], ['2026-10-02', 147.8, 10.6, 125.5], ['2026-10-03', 148.1, '', ''],
  ['2026-10-04', 148.2, 10.7, 125.8], ['2026-10-05', 148.1, 10.5, 125.9], ['2026-10-06', 148.1, 10.5, 125.9],
  ['2026-10-07', 146.2, 10.2, 124.7], ['2026-10-08', 147.7, '', ''], ['2026-10-09', 147.3, 10.4, 125.4],
  ['2026-10-10', 148.2, 10.4, 126.1], ['2026-10-11', 146.8, 10.6, 124.6], ['2026-10-13', 148.9, 10.6, 126.4],
  ['2026-10-14', 147.2, 10.3, 125.4], ['2026-10-15', 148.1, 10.5, 125.9],
];
export const SHEET: unknown[][] = [HEADER, ...RAW.map(([d, w, bf, m]) => [d, w, bf, m, '', '', 'auto-sync'])];

describe('toNum (blank is missing, never 0)', () => {
  it('treats blank/null as missing', () => {
    expect(toNum('')).toBeNull();
    expect(toNum('  ')).toBeNull();
    expect(toNum(null)).toBeNull();
    expect(toNum(undefined)).toBeNull();
    expect(toNum('abc')).toBeNull();
  });
  it('parses real numbers, including 0 (validation decides plausibility)', () => {
    expect(toNum('10.5')).toBe(10.5);
    expect(toNum(0)).toBe(0);
  });
});

describe('cleanReading plausibility filter', () => {
  it('drops BF%/muscle of 0 (the failed-measurement signature) but keeps the weight', () => {
    expect(cleanReading({ date: '2026-10-08', weight: 147.7, bf: 0, muscle: 0 })).toEqual({
      date: '2026-10-08', weight: 147.7, bf: null, muscle: null,
    });
  });
  it('drops BF% outside 3–60', () => {
    expect(cleanReading({ date: 'd', weight: 150, bf: 2.9, muscle: 125 }).bf).toBeNull();
    expect(cleanReading({ date: 'd', weight: 150, bf: 60.1, muscle: 125 }).bf).toBeNull();
    expect(cleanReading({ date: 'd', weight: 150, bf: 3, muscle: 125 }).bf).toBe(3);
    expect(cleanReading({ date: 'd', weight: 150, bf: 60, muscle: 125 }).bf).toBe(60);
  });
  it('drops muscle below 50% of body weight (or above body weight)', () => {
    expect(cleanReading({ date: 'd', weight: 150, bf: 10, muscle: 74.9 }).muscle).toBeNull();
    expect(cleanReading({ date: 'd', weight: 150, bf: 10, muscle: 75 }).muscle).toBe(75);
    expect(cleanReading({ date: 'd', weight: 150, bf: 10, muscle: 151 }).muscle).toBeNull();
  });
  it('a non-positive weight voids weight AND muscle (muscle is judged against weight)', () => {
    const r = cleanReading({ date: 'd', weight: 0, bf: 10.5, muscle: 125 });
    expect(r.weight).toBeNull();
    expect(r.muscle).toBeNull();
    expect(r.bf).toBe(10.5);
    expect(cleanReading({ date: 'd', weight: -5 }).weight).toBeNull();
  });
});

describe('parseBodyCompSheet', () => {
  it('parses the blank 2026-10-08 cells as null, not 0', () => {
    const oct8 = parseBodyCompSheet(SHEET).find((p) => p.date === '2026-10-08')!;
    expect(oct8).toEqual({ date: '2026-10-08', weight: 147.7, bf: null, muscle: null });
  });
  it('also rejects a literal 0 written by an older sync', () => {
    const rows = [HEADER, ['2026-10-08', 147.7, 0, 0, '', '', '']];
    expect(parseBodyCompSheet(rows)[0]).toEqual({ date: '2026-10-08', weight: 147.7, bf: null, muscle: null });
  });
  it('skips non-date narrative rows and sorts oldest → newest', () => {
    const rows = [HEADER, ['2026-10-02', 147.8, 10.6, 125.5], ['notes', 'x'], ['2026-10-01', 149.4, 11.4, 125.7]];
    expect(parseBodyCompSheet(rows).map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02']);
  });
});

describe('weekOverWeek (regression: the false "~3 lb muscle drop")', () => {
  it('excludes the failed 2026-10-08 reading from both averages', () => {
    const w = weekOverWeek(parseBodyCompSheet(SHEET), '2026-10-15');
    // This week (10-09..10-15): 125.4, 126.1, 124.6, 126.4, 125.4, 125.9 → 125.63
    expect(w.muscleThisWeek).toBeCloseTo(125.63, 2);
    // Last week (10-02..10-08), 10-03 and 10-08 blank: 125.5, 125.8, 125.9, 125.9, 124.7 → 125.56
    expect(w.muscleLastWeek).toBeCloseTo(125.56, 2);
    // Real change is noise (+0.07), nowhere near a 3 lb drop.
    expect(Math.abs(w.muscleDelta!)).toBeLessThan(0.5);
    expect(w.bfThisWeek).toBeGreaterThan(10);
    expect(w.bfLastWeek).toBeGreaterThan(10);
  });
  it('what the old parser did: treating blanks as 0 fakes a multi-pound muscle drop', () => {
    // Sanity check that the fixture reproduces the bug the fix removes.
    const naive = [125.5, 0, 125.8, 125.9, 125.9, 124.7, 0];
    const naiveAvg = naive.reduce((a, b) => a + b, 0) / naive.length;
    expect(125.63 - naiveAvg).toBeGreaterThan(3);
  });
});

describe('Withings tool cleaning', () => {
  it('get_withings_latest: nulls a 0 BF%/muscle and flags data quality', () => {
    const s = cleanWithingsSummary({
      weightLbs: 147.7, bodyFatPercent: 0, muscleMassLbs: 0, muscleMassPercent: 0, measuredAt: '2026-10-08T11:00:00Z',
    });
    expect(s.weightLbs).toBe(147.7);
    expect(s.bodyFatPercent).toBeNull();
    expect(s.muscleMassLbs).toBeNull();
    expect(s.muscleMassPercent).toBeNull();
    expect(s.dataQuality).toMatch(/bodyFatPercent/);
  });
  it('get_withings_latest: leaves a good reading untouched and unflagged', () => {
    const s = cleanWithingsSummary({ weightLbs: 148.1, bodyFatPercent: 10.5, muscleMassLbs: 125.9, measuredAt: '2026-10-15T11:00:00Z' });
    expect(s).toMatchObject({ weightLbs: 148.1, bodyFatPercent: 10.5, muscleMassLbs: 125.9 });
    expect(s.dataQuality).toBeUndefined();
  });
  it('get_withings_history: drops zero/negative/missing weights', () => {
    const h = cleanWeightHistory([
      { date: 'a', weight: { lbs: 148.1 } },
      { date: 'b', weight: { lbs: 0 } },
      { date: 'c', weight: { lbs: -1 } },
      { date: 'd', weight: {} },
    ]) as unknown[];
    expect(h).toHaveLength(1);
  });
});

describe('weightTrend (regression: 21d slope anchored on the Sept 25–30 highs)', () => {
  const pts = parseBodyCompSheet(SHEET);

  it('reports BOTH a 14d and a 21d least-squares slope', () => {
    const w = weightTrend(pts, '2026-10-16');
    expect(w.slope14).not.toBeNull();
    expect(w.slope21).not.toBeNull();
    expect(w.n14).toBeGreaterThanOrEqual(4);
  });
  it('the 21d window alone reads "too fast" (the original bug)…', () => {
    const w = weightTrend(pts, '2026-10-16');
    expect(-(w.slope21 as number)).toBeGreaterThan(TARGET_LOSS_MAX);
  });
  it('…but the 14d window is ~flat (146–149 since Oct 2), so it is NOT flagged too fast', () => {
    const w = weightTrend(pts, '2026-10-16');
    expect(Math.abs(w.slope14 as number)).toBeLessThan(TARGET_LOSS_MIN);
    expect(w.tooFast).toBe(false);
    expect(w.verdict).toBe('mixed');
    expect(w.note).toMatch(/do NOT call it too fast/);
  });
  it('flags too fast only when both windows exceed the band', () => {
    // Steady -1.4 lb/wk for 21 days.
    const steep = Array.from({ length: 21 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`, weight: 160 - i * 0.2, bf: 12, muscle: 128,
    }));
    const w = weightTrend(steep, '2026-10-21');
    expect(w.tooFast).toBe(true);
    expect(w.verdict).toBe('too_fast');
  });
  it('a steep 14d with a flat 21d is also "mixed", never "too fast"', () => {
    const p = [
      ...Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(i + 20).padStart(2, '0')}`, weight: 150, bf: 12, muscle: 128 })),
      ...Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, weight: 152 - i * 0.3, bf: 12, muscle: 128 })),
    ];
    const w = weightTrend(p, '2026-10-14');
    expect(w.tooFast).toBe(false);
  });
  it('needs enough readings: <4 in the window is insufficient_data, not a verdict', () => {
    const w = weightTrend(pts.slice(-2), '2026-10-16');
    expect(w.slope14).toBeNull();
    expect(w.verdict).toBe('insufficient_data');
  });
});

describe('muscleSlope14 ignores the failed reading', () => {
  it('computes a near-flat trend from valid readings only', () => {
    const m = muscleSlope14(parseBodyCompSheet(SHEET), '2026-10-16');
    expect(m.n).toBe(10); // 12 dated rows in (10-02, 10-16] minus 2 blank (10-03, 10-08)
    expect(Math.abs(m.slope as number)).toBeLessThan(0.5);
  });
});
