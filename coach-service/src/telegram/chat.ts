import { runTurn } from '../llm/agent.js';
import { mainSession } from '../session/session.js';
import { appendDailyLog } from '../memory/store.js';
import { todayStr } from '../util/time.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Inbound chat handler — the two-way coaching loop. Loads the running main-session
 * conversation, runs a coaching turn with tools + retrieved memory, persists the
 * updated history, and returns the reply text.
 */
export async function handleUserMessage(text: string): Promise<string> {
  const history = await mainSession.getHistory();
  const messages = [...history, { role: 'user' as const, content: text }];

  await appendDailyLog(todayStr(config.tz), `[matt] ${text}`);

  const result = await runTurn({
    messages,
    sessionType: 'main',
    retrievalQuery: text,
    // Chat runs on the heavy tier (Sonnet): better instruction-following and
    // faithfulness to the snapshot/corrections than Haiku — accuracy > cost here.
    tier: 'heavy',
    maxTokens: 1200,
    maxIterations: 8,
  });

  const reply = result.text.trim() || "I'm here — give me a second and try that again.";

  // Persist a CLEAN, text-only alternating history (prior turns + this user msg +
  // the final reply). We deliberately do NOT store the intra-turn tool_use /
  // tool_result blocks: a turn that hit the iteration cap can end on a dangling
  // tool block, which would make the next request invalid. Tool *effects* are
  // already persisted (sheets, memory); the conversation thread is what matters.
  await mainSession.setHistory([
    ...history,
    { role: 'user', content: text },
    { role: 'assistant', content: reply },
  ]);
  await appendDailyLog(todayStr(config.tz), `[vic] ${reply}`);
  logger.info('Handled inbound chat message');
  return reply;
}
