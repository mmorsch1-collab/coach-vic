import { runTurn } from '../llm/agent.js';
import {
  assessWhoop,
  midMorningOpportunity,
  afternoonOpportunity,
  eveningConcern,
  type WhoopAssessment,
} from './gating.js';
import { logger } from '../logger.js';
import { workoutSheetStatus } from '../coaching/workoutIngest.js';
import { parseWorkoutDb } from '../coaching/metrics.js';
import { bridge } from '../bridge/client.js';
import { todayStr } from '../util/time.js';
import { config } from '../config.js';
import { isSkip } from './sentinel.js';

/**
 * Day-part check-ins. Each runs an LLM-FREE assessment first; Claude is only
 * invoked when there's a genuine coachable moment (the cost lever). High bar:
 * default to silence.
 */

export interface CheckinResult {
  sent: boolean;
  message?: string;
  reason?: string;
}

async function composeNudge(intent: string, a: WhoopAssessment): Promise<string> {
  const instruction = [
    `Coachable moment detected: ${intent}`,
    `Context (do not dump this at Matt): recovery=${a.recovery}, strain=${a.strain}, color=${a.color}.`,
    ``,
    `Write ONE short Telegram message in Coach Vic's voice — calm, brief, a single clear`,
    `recommendation, no data dump, no visible reasoning. If, on reflection, this isn't genuinely`,
    `worth interrupting Matt, reply with exactly "SKIP" and nothing else.`,
  ].join('\n');

  const r = await runTurn({
    messages: [{ role: 'user', content: instruction }],
    sessionType: 'isolated',
    retrievalQuery: intent,
    tier: 'primary',
    maxTokens: 400,
    maxIterations: 4,
  });
  return r.text.trim();
}

type OpportunityFn = (a: WhoopAssessment) => string | null;

async function runGenericCheckin(label: string, opp: OpportunityFn): Promise<CheckinResult> {
  // Day-part nudges need a recovery SCORED TODAY (the strict 2h window is only for
  // the morning ritual). A score from yesterday is stale — stay silent.
  const a = await assessWhoop('checkin');
  if (!a.ok) return { sent: false, reason: a.reason ?? 'whoop unavailable' };
  if (!a.fresh) return { sent: false, reason: 'whoop not fresh' };

  const intent = opp(a);
  if (!intent) return { sent: false, reason: 'no coachable moment' };

  const message = await composeNudge(intent, a);
  if (isSkip(message)) {
    logger.info({ label }, 'LLM judged not worth sending');
    return { sent: false, reason: 'llm skipped' };
  }
  return { sent: true, message };
}

export const runMidMorningCheck = () => runGenericCheckin('mid-morning', midMorningOpportunity);
export const runAfternoonCheck = () => runGenericCheckin('afternoon', afternoonOpportunity);
export const runEveningCheck = () => runGenericCheckin('evening', eveningConcern);

/**
 * Missed-workout check (weekday mid-morning). Deterministic, and it READS THE
 * SHEET FIRST: filled Weight+Reps means Matt trained even if he never said so —
 * never nudge someone about a workout he already did. Only fires when a sheet
 * was built for today, nothing is filled in, and nothing was logged in chat.
 */
export async function runMissedWorkoutCheck(): Promise<CheckinResult> {
  const today = todayStr(config.tz);

  const sheet = await workoutSheetStatus(today);
  if (!sheet.exists) return { sent: false, reason: 'no workout sheet today' };
  if (sheet.filledSets > 0) return { sent: false, reason: `sheet has ${sheet.filledSets} filled sets — he trained` };

  // He might have logged via chat (log_set/log_workout) without touching the sheet.
  try {
    const rows = (await bridge.readSheet('WORKOUT_DATABASE')) as unknown[][];
    const todayLogs = parseWorkoutDb(rows).filter((l) => l.date === today);
    if (todayLogs.length > 0) return { sent: false, reason: 'workout already logged in DB' };
  } catch {
    /* DB unreadable — proceed; worst case the nudge asks about a done workout */
  }

  const instruction = [
    `Coachable moment: it's mid-morning and today's planned workout looks missed.`,
    `Context (do NOT dump this at him): the sheet "${sheet.title}" was built for today with`,
    `${sheet.exercises} exercises, but nothing is filled in and nothing was logged.`,
    ``,
    `Write ONE short Telegram message in Coach Vic's voice: no guilt, no scolding. Ask if the`,
    `5:30 session happened (maybe he just hasn't filled the sheet) and offer ONE concrete`,
    `fallback: the 20-min home-gym backup matched to today's split, or a shifted gym window if`,
    `his calendar allows. If, on reflection, this isn't worth interrupting him, reply exactly "SKIP".`,
  ].join('\n');

  const r = await runTurn({
    messages: [{ role: 'user', content: instruction }],
    sessionType: 'isolated',
    retrievalQuery: 'missed workout home gym backup reschedule',
    tier: 'primary',
    maxTokens: 400,
    maxIterations: 4,
  });
  const message = r.text.trim();
  if (isSkip(message)) return { sent: false, reason: 'llm skipped' };
  return { sent: true, message };
}
