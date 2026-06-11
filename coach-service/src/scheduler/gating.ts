import { bridge, isAuthError, type WhoopToday } from '../bridge/client.js';
import { isFresh } from '../util/time.js';
import { logger } from '../logger.js';

/**
 * Deterministic, LLM-free assessment of WHOOP data. The scheduler polls this
 * cheaply and only invokes Claude when there's a genuine coachable moment — the
 * core cost lever (more monitoring, fewer model calls).
 */

export type RecoveryColor = 'green' | 'yellow' | 'red' | 'unknown';

export interface WhoopAssessment {
  ok: boolean; // data fetched and usable
  authError: boolean;
  fresh: boolean; // metadata within 2h AND score_state SCORED
  color: RecoveryColor;
  recovery: number | null;
  strain: number | null;
  data?: WhoopToday;
  reason?: string;
}

export function recoveryColor(score: number | null | undefined): RecoveryColor {
  if (score == null) return 'unknown';
  if (score >= 67) return 'green';
  if (score >= 34) return 'yellow';
  return 'red';
}

/**
 * @param maxAgeHours freshness window for recovery.metadata.updated_at. The 5:15
 * ritual needs a freshly-scored TODAY recovery (2h). Day-part check-ins only need
 * "scored this morning" — WHOOP scores once after waking, so a 2h window would
 * make every 10:30+/15:30/20:30 check-in permanently silent ("whoop not fresh").
 */
export async function assessWhoop(maxAgeHours = 2): Promise<WhoopAssessment> {
  let data: WhoopToday;
  try {
    data = await bridge.whoopToday();
  } catch (err) {
    const authError = isAuthError(err);
    logger.warn({ err, authError }, 'WHOOP fetch failed in assessment');
    return {
      ok: false,
      authError,
      fresh: false,
      color: 'unknown',
      recovery: null,
      strain: null,
      reason: authError ? 'not authenticated' : 'fetch failed',
    };
  }

  const recovery = data.recovery?.score ?? null;
  const strain = data.strain?.score ?? null;
  const updatedAt = data.recovery?.metadata?.updated_at;
  const scoreState = data.recovery?.metadata?.score_state;
  const fresh = isFresh(updatedAt, maxAgeHours) && scoreState === 'SCORED';

  return {
    ok: true,
    authError: false,
    fresh,
    color: recoveryColor(recovery),
    recovery,
    strain,
    data,
    reason: fresh ? undefined : `stale or unscored (updated_at=${updatedAt}, state=${scoreState})`,
  };
}

/**
 * Coachable-moment heuristics for the day-part check-ins (LLM-free pre-filter).
 * Returns a short intent string when a message is warranted, else null.
 */
export function midMorningOpportunity(a: WhoopAssessment): string | null {
  if (!a.fresh) return null;
  // Green recovery + low strain by mid-morning + likely no workout yet.
  if (a.color === 'green' && (a.strain ?? 0) < 4) {
    return 'Green recovery but strain still low by mid-morning — nudge to move before meetings.';
  }
  return null;
}

export function afternoonOpportunity(a: WhoopAssessment): string | null {
  if (!a.fresh) return null;
  if (a.color === 'green' && (a.strain ?? 0) < 6) {
    return 'Green recovery, low all-day strain — suggest movement before the evening.';
  }
  if (a.color === 'red' && (a.strain ?? 0) > 12) {
    return 'Red recovery with high strain — warn to ease up and protect tonight\'s sleep.';
  }
  return null;
}

export function eveningConcern(a: WhoopAssessment): string | null {
  if (!a.fresh) return null;
  // High bar: only a clear sleep-protection case.
  if ((a.strain ?? 0) > 14) {
    return 'High strain day — protect tonight\'s sleep for tomorrow\'s recovery.';
  }
  return null;
}
