import { todayStr } from '../util/time.js';

/**
 * Hard freshness gate for WHOOP "today" data — one rule, used by get_whoop_today,
 * the snapshot builder, and the scheduled jobs.
 *
 * WHY (2026-10-16): the snapshot showed WHOOP as "SCORED, 78.8h old" and still
 * presented it as today's recovery. Two holes let that through:
 *  - the date check compared the bridge's `date` field, which the bridge sets to
 *    "now" on every request — so it was always "today" no matter how old the
 *    recovery was;
 *  - outside the briefing window freshness was skipped entirely ("SCORED is
 *    enough"), so a 3-day-old score passed whenever WHOOP hadn't synced.
 *
 * Rules:
 *  - ritual  (morning briefing): SCORED and updated within the last 2h.
 *  - checkin (day-part nudges, chat, snapshot after the briefing window):
 *            SCORED and scored TODAY in the user's timezone.
 * Anything else is stale and must be labeled STALE_LABEL — never shown as today's numbers.
 */

export type FreshnessMode = 'ritual' | 'checkin';

export const STALE_LABEL = 'stale, do not coach on it';
export const RITUAL_MAX_AGE_H = 2;

export interface WhoopMeta {
  created_at?: string;
  updated_at?: string;
  score_state?: string;
}

export interface Freshness {
  usable: boolean;
  mode: FreshnessMode;
  scored: boolean;
  ageHours: number | null;
  /** Local (tz) date the recovery was scored, or null if unknown. */
  scoredDate: string | null;
  scoredToday: boolean;
  /** Human-readable reason; when !usable this starts with STALE_LABEL. */
  label: string;
}

export function assessFreshness(
  meta: WhoopMeta | undefined | null,
  mode: FreshnessMode,
  tz: string,
  now: Date = new Date(),
): Freshness {
  const scored = meta?.score_state === 'SCORED';
  const updatedMs = Date.parse(String(meta?.updated_at ?? ''));
  const createdMs = Date.parse(String(meta?.created_at ?? ''));
  const ageMs = Number.isFinite(updatedMs) ? updatedMs : createdMs;
  const ageHours = Number.isFinite(ageMs) ? Math.round(((now.getTime() - ageMs) / 3_600_000) * 10) / 10 : null;
  // "Scored today" = the recovery record was created today (local). created_at is
  // when WHOOP scored the night; updated_at can move on a later re-score.
  const scoredMs = Number.isFinite(createdMs) ? createdMs : updatedMs;
  const scoredDate = Number.isFinite(scoredMs) ? todayStr(tz, new Date(scoredMs)) : null;
  const scoredToday = scoredDate != null && scoredDate === todayStr(tz, now);

  let usable: boolean;
  let why: string;
  if (!scored) {
    usable = false;
    why = `score_state=${meta?.score_state ?? 'missing'} (not SCORED)`;
  } else if (ageHours == null) {
    usable = false;
    why = 'no score timestamp';
  } else if (ageHours < -0.25) {
    usable = false;
    why = `score timestamp is in the future (${ageHours}h)`;
  } else if (mode === 'ritual') {
    usable = ageHours <= RITUAL_MAX_AGE_H;
    why = usable ? `scored ${ageHours}h ago` : `scored ${ageHours}h ago (> ${RITUAL_MAX_AGE_H}h for the morning briefing)`;
  } else {
    usable = scoredToday;
    why = usable ? `scored today, ${ageHours}h ago` : `last scored ${scoredDate ?? 'unknown'} (${ageHours}h ago), not today`;
  }
  return {
    usable,
    mode,
    scored,
    ageHours,
    scoredDate,
    scoredToday,
    label: usable ? why : `${STALE_LABEL} — ${why}`,
  };
}

/**
 * Shape a WHOOP "today" payload for the model. Fresh → the data plus its
 * freshness. Stale → NO numbers at all (so they can't be quoted as today's),
 * just the stale label and when it was last scored.
 */
export function gateWhoopToday(data: any, mode: FreshnessMode, tz: string, now: Date = new Date()): unknown {
  const f = assessFreshness(data?.recovery?.metadata, mode, tz, now);
  if (f.usable) {
    // The bridge's `date` is the request time, not the score date — replace it
    // with the real scored date so nothing downstream trusts the wrong field.
    return { ...data, date: f.scoredDate, freshness: { status: 'fresh', ...f } };
  }
  return {
    stale: true,
    status: STALE_LABEL,
    freshness: f,
    instruction:
      'WHOOP has not produced a usable score for today. Do NOT quote recovery, HRV, RHR, sleep or ' +
      'strain as today\'s numbers and do not make a readiness call from them. If recovery matters, ' +
      'say today\'s score is not in yet.',
  };
}
