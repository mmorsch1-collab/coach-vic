import { runTurn } from '../llm/agent.js';
import {
  assessWhoop,
  midMorningOpportunity,
  afternoonOpportunity,
  eveningConcern,
  type WhoopAssessment,
} from './gating.js';
import { logger } from '../logger.js';
import { todayProteinTotal, PROTEIN_TARGET_G } from '../coaching/nutrition.js';

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

/**
 * Robust SKIP detection. The model is told to reply "SKIP" to suppress a nudge,
 * but it sometimes wraps it in markdown or trails it after reasoning (e.g.
 * "...not worth it.\n\n**SKIP**"). Exact-match misses those and would leak the
 * reasoning to Matt — so treat a trailing/standalone SKIP token as a skip.
 */
function isSkip(text: string): boolean {
  const t = text.replace(/[*_`>#]/g, '').trim().toUpperCase();
  if (!t) return true;
  const tokens = t.split(/\s+/);
  return t === 'SKIP' || tokens[tokens.length - 1] === 'SKIP';
}

type OpportunityFn = (a: WhoopAssessment) => string | null;

async function runGenericCheckin(label: string, opp: OpportunityFn): Promise<CheckinResult> {
  const a = await assessWhoop();
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

/**
 * Evening protein check — fires ONLY if Matt is behind his daily protein target.
 * Deterministic gate (the running total is computed, not recalled); LLM only
 * composes the nudge (and may still SKIP if not worth interrupting).
 */
export async function runProteinCheck(): Promise<CheckinResult> {
  const { totalG, remainingG, meals } = await todayProteinTotal();
  if (totalG >= PROTEIN_TARGET_G) return { sent: false, reason: 'protein target met' };

  const logged = meals > 0 ? `Logged so far: ${Math.round(totalG)}g.` : 'Nothing logged yet today.';
  const instruction = [
    `Coachable moment: Matt is behind his protein target this evening.`,
    `Context (do NOT dump this at him): today=${Math.round(totalG)}g / ${PROTEIN_TARGET_G}g, ${remainingG}g to go. ${logged}`,
    ``,
    `Write ONE short Telegram message in Coach Vic's voice: note where he stands and give a single`,
    `concrete way to close the gap tonight (a specific high-protein option), or — if little is logged —`,
    `ask what he ate today so you can log it. No data dump, no visible reasoning. If it's genuinely too`,
    `late or not worth interrupting, reply with exactly "SKIP" and nothing else.`,
  ].join('\n');

  const r = await runTurn({
    messages: [{ role: 'user', content: instruction }],
    sessionType: 'isolated',
    retrievalQuery: 'protein intake evening',
    tier: 'primary',
    maxTokens: 400,
    maxIterations: 4,
  });
  const message = r.text.trim();
  if (isSkip(message)) {
    logger.info('Protein check: LLM judged not worth sending');
    return { sent: false, reason: 'llm skipped' };
  }
  return { sent: true, message };
}

export const runMidMorningCheck = () => runGenericCheckin('mid-morning', midMorningOpportunity);
export const runAfternoonCheck = () => runGenericCheckin('afternoon', afternoonOpportunity);
export const runEveningCheck = () => runGenericCheckin('evening', eveningConcern);
