import { describe, it, expect } from 'vitest';
import { todayStr, hourInTz, isFresh, localDateTime } from '../src/util/time.js';
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
