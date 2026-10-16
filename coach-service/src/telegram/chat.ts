import { runTurn } from '../llm/agent.js';
import { runAsUserTurn } from '../llm/turnContext.js';
import { mainSession } from '../session/session.js';
import { appendDailyLog } from '../memory/store.js';
import { todayStr } from '../util/time.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface InboundMessage {
  text: string;
  /** Optional photo (e.g. a meal pic) — sent to the model for this turn only. */
  image?: { base64: string; mediaType: string };
}

/**
 * Inbound chat handler — the two-way coaching loop. Loads the running main-session
 * conversation, runs a coaching turn with tools + retrieved memory, persists the
 * updated history, and returns the reply text.
 */
export async function handleUserMessage(
  input: string | InboundMessage,
  opts: { retry?: boolean } = {},
): Promise<string> {
  const { text, image } = typeof input === 'string' ? { text: input, image: undefined } : input;
  const history = await mainSession.getHistory();

  // Photo turns: image block + caption (vision). The image rides ONLY this turn's
  // request — history persists a text placeholder (cheap + byte-stable for caching).
  const userContent: any = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
        {
          type: 'text',
          text:
            text ||
            'Matt sent this photo with no caption. If it is food, estimate the protein and log it ' +
              'with log_meal; otherwise respond to what it shows.',
        },
      ]
    : text;
  const messages = [...history, { role: 'user' as const, content: userContent }];

  // A resend after a failed attempt is tagged so the log doesn't read as a duplicate.
  const tag = opts.retry ? '[matt:retry-after-failure]' : '[matt]';
  await appendDailyLog(todayStr(config.tz), `${tag} ${image ? `[photo] ${text}`.trim() : text}`);

  // Mark this as a turn Matt started (turnContext.ts): only these may self-edit.
  const result = await runAsUserTurn(text, () => runTurn({
    messages,
    sessionType: 'main',
    retrievalQuery: buildRetrievalQuery(history, text),
    // Chat runs on the heavy tier (Sonnet): better instruction-following and
    // faithfulness to the snapshot/corrections than Haiku — accuracy > cost here.
    tier: 'heavy',
    // Headroom for build-heavy turns (e.g. "create all 5 sheets + calendar events"):
    // 1200 truncated mid-tool-emission, so the tool calls never fired. 4096 leaves
    // room for the preamble + the batch of tool_use blocks. You only pay for output
    // actually generated, so ordinary short replies are unaffected.
    maxTokens: 4096,
    maxIterations: 8,
  }));

  const reply = result.text.trim() || "I'm here — give me a second and try that again.";

  // Persist a CLEAN, text-only alternating history (prior turns + this user msg +
  // the final reply). We deliberately do NOT store the intra-turn tool_use /
  // tool_result blocks: a turn that hit the iteration cap can end on a dangling
  // tool block, which would make the next request invalid. Tool *effects* are
  // already persisted (sheets, memory); the conversation thread is what matters.
  await mainSession.setHistory([
    ...history,
    { role: 'user', content: image ? `[sent a photo] ${text}`.trim() : text },
    { role: 'assistant', content: reply },
  ]);
  await appendDailyLog(todayStr(config.tz), `[vic] ${reply}`);
  logger.info('Handled inbound chat message');
  return reply;
}

/**
 * Retrieval query = current message + the previous user message. Follow-ups and
 * pronoun questions ("what about that?", "should I?") carry no keywords of their
 * own — the prior message supplies the topic.
 */
function buildRetrievalQuery(history: Array<{ role: string; content: unknown }>, text: string): string {
  const prevUser = [...history].reverse().find((m) => m.role === 'user');
  const prevText = typeof prevUser?.content === 'string' ? prevUser.content : '';
  return [prevText, text].filter(Boolean).join(' ').slice(-500);
}
