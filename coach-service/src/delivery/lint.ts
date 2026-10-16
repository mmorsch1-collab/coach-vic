import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Pre-send lint for PROACTIVE (scheduled) messages. Every LLM-composed message a
 * job sends passes through here before delivery.
 *
 * WHY (2026-10-16): proactive messages were leaking internal reasoning, showing
 * calculations, and correcting the coach's own earlier mistakes inside long data
 * dumps — the opposite of MESSAGE_COMPOSITION_STANDARDS.md ("lead with the
 * recommendation, give data only when asked"). The system prompt already says
 * this; a prompt is a request, the lint is the guarantee.
 *
 * Flow: lint → if it fails, ONE rewrite pass with the violations named → lint
 * again → if it still fails, the message is SUPPRESSED (silence beats a bad
 * message; every check-in already defaults to silence).
 */

export interface LintResult {
  ok: boolean;
  violations: string[];
}

// Working / meta language: the coach thinking out loud or correcting itself.
const WORKING_PATTERNS: Array<[RegExp, string]> = [
  [/\blet me\b/i, 'working language ("let me…")'],
  [/\bi('ll| will) (now )?(calculate|compute|check|look at|pull|run the numbers)/i, 'working language (narrating steps)'],
  [/\b(i (calculated|computed|recalculated|re-ran|reran)|recalculat\w*|running the numbers|doing the math|the math (says|shows|works out))\b/i, 'calculation narrative'],
  [/\b(correction:|to correct (my|an?|the) (earlier|previous)|i was wrong|i got (that|it) wrong|my (earlier|previous|last) (message|number|figure|calculation|estimate|call) (was|is) (wrong|off|incorrect)|i (mis|over|under)(stated|calculated|counted|reported|estimated))/i, 'correcting an earlier error'],
  [/\b(wait,|on second thought|scratch that|actually, (it|that|the) (was|is)n?'?t?)/i, 'self-correction'],
  [/\b(looking at (the|your) (data|numbers|logs|snapshot)|based on (the|your) (data|numbers|snapshot)|according to (the|my) (snapshot|data|tools?))\b/i, 'narrating the data review'],
  [/\b(snapshot|tool (call|result)|get_[a-z_]+|reasoning|my analysis|internal)\b/i, 'internal/system terms'],
  [/\bstep \d\b|^\s*\d+\.\s.*\n\s*\d+\.\s.*\n\s*\d+\.\s/im, 'step-by-step working'],
];

// Arithmetic shown in the message ("147.7 - 146.2 = 1.5", "3 x 12").
const CALC_RE = /\d+(?:\.\d+)?\s*(?:[-+×x*/÷])\s*\d+(?:\.\d+)?\s*(?:=|≈)\s*-?\d/;

// GOAL.md hands-off protein rule: never solicit meals / protein updates.
const SOLICIT_PATTERNS: RegExp[] = [
  /\bwhat (did|have) you (eat|eaten|had)\b/i,
  /\bwhat('?s| is| was) (for )?(breakfast|lunch|dinner)\b/i,
  /\b(log|send|share|tell me) (your|any|today'?s|the) (meals?|food|protein|macros)\b/i,
  /\bhow('?s| is) (your )?protein\b/i,
  /\bhow much protein\b/i,
  /\b(did|have) you (hit|eaten|had|get) (your )?(protein|\d+\s?g)\b/i,
  /\bprotein[^.?!\n]{0,60}\?/i,
  /\b(\d+\s?g|grams?) (to go|left|remaining)\b/i,
];

// The opening sentence must be the recommendation, not data or meta.
const BAD_OPENING = /^\s*(?:[*_#>-]\s*)*(here'?s|so[,:]|ok(ay)?[,!:]|alright[,!]|update:|summary:|analysis:|data:|looking|based on|i (checked|looked|pulled|reviewed|noticed|see|ran)|your (data|numbers|stats|metrics)|\d)/i;

export interface LintOptions {
  /** Max characters (data-dump guard). Default 700; the morning briefing gets more. */
  maxChars?: number;
  /** Max standalone numbers (data-dump guard). Default 8. */
  maxNumbers?: number;
}

/** Count numbers a reader would parse as data (ignores URLs and clock times). */
export function countNumbers(text: string): number {
  const stripped = text.replace(/https?:\/\/\S+/g, ' ').replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi, ' ');
  return (stripped.match(/(?<![\w.])\d+(?:\.\d+)?%?(?![\w.])/g) || []).length;
}

export function lintProactive(text: string, opts: LintOptions = {}): LintResult {
  const maxChars = opts.maxChars ?? 700;
  const maxNumbers = opts.maxNumbers ?? 8;
  const v: string[] = [];
  const t = String(text ?? '');
  if (!t.trim()) return { ok: false, violations: ['empty message'] };

  for (const [re, label] of WORKING_PATTERNS) if (re.test(t)) v.push(label);
  if (CALC_RE.test(t)) v.push('shows a calculation');
  if (SOLICIT_PATTERNS.some((re) => re.test(t))) v.push('solicits meals/protein (GOAL.md hands-off rule)');
  if (BAD_OPENING.test(t)) v.push('does not lead with the recommendation');
  if (t.length > maxChars) v.push(`too long (${t.length} > ${maxChars} chars — data dump)`);
  const n = countNumbers(t);
  if (n > maxNumbers) v.push(`too many numbers (${n} > ${maxNumbers} — data dump)`);
  return { ok: v.length === 0, violations: [...new Set(v)] };
}

export type Rewriter = (draft: string, violations: string[]) => Promise<string>;

const client = new Anthropic({ apiKey: config.anthropicApiKey });

/** Default rewriter: one cheap, tool-free pass on the primary model. */
export const llmRewriter: Rewriter = async (draft, violations) => {
  const resp = await client.messages.create({
    model: config.modelPrimary,
    max_tokens: 400,
    system:
      'You rewrite a health coach\'s outgoing Telegram message so it can be sent. Rules: open with the ' +
      'single recommendation in the first sentence; at most 2–3 short sentences; no calculations, no ' +
      'working, no mention of tools/data review, no correcting earlier messages; at most a couple of ' +
      'numbers; never ask what he ate or about protein. Keep any URL exactly. If nothing worth sending ' +
      'remains, reply exactly SKIP. Reply with the message text only.',
    messages: [{ role: 'user', content: `Problems: ${violations.join('; ')}\n\nDraft:\n${draft}` }],
  });
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
};

/**
 * Lint → (one rewrite) → lint. Returns the sendable text, or null to suppress.
 * Never throws: a rewriter failure suppresses rather than sending a bad draft.
 */
export async function finalizeProactive(
  type: string,
  draft: string,
  opts: LintOptions = {},
  rewrite: Rewriter = llmRewriter,
): Promise<string | null> {
  const first = lintProactive(draft, opts);
  if (first.ok) return draft;
  logger.warn({ type, violations: first.violations }, 'Proactive draft failed lint; rewriting once');
  let second: string;
  try {
    second = (await rewrite(draft, first.violations)).trim();
  } catch (err) {
    logger.error({ err, type }, 'Proactive rewrite failed; suppressing message');
    return null;
  }
  if (!second || /^\**\s*SKIP\s*\**$/i.test(second)) {
    logger.info({ type }, 'Rewrite judged message not worth sending; suppressed');
    return null;
  }
  const again = lintProactive(second, opts);
  if (again.ok) return second;
  logger.warn({ type, violations: again.violations }, 'Proactive rewrite still failed lint; suppressed');
  return null;
}
