import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { TOOLS, executeTool } from './tools.js';
import { getStaticSystem, buildDynamicSystem } from './systemPrompt.js';
import { recordTurnUsage, type Usage } from './usage.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

// The static brain prompt is cached + hot-reloadable in systemPrompt.ts so the
// self-edit tool can invalidate it after editing a brain file (no restart).
export { invalidateSystemCache } from './systemPrompt.js';

export type ChatMessage = Anthropic.MessageParam;

export interface RunTurnOptions {
  /** Conversation so far (for multi-turn chat). For one-shot jobs, a single user msg. */
  messages: ChatMessage[];
  sessionType: 'main' | 'isolated';
  /** Text used to retrieve relevant RAG memory for this turn. */
  retrievalQuery?: string;
  /** 'primary' (Haiku) or 'heavy' (Sonnet) for deeper reasoning. */
  tier?: 'primary' | 'heavy';
  maxTokens?: number;
  /** Safety cap on tool-use round-trips. */
  maxIterations?: number;
}

export interface RunTurnResult {
  text: string;
  messages: ChatMessage[]; // includes assistant + tool exchanges appended
  stoppedEarly: boolean;
}

/**
 * Run one coaching turn: call Claude with tools, resolve any tool calls, loop
 * until a final text answer (or the iteration cap). Returns the final text and
 * the extended message history.
 */
export async function runTurn(opts: RunTurnOptions): Promise<RunTurnResult> {
  const tier = opts.tier ?? 'primary';
  const model = tier === 'heavy' ? config.modelHeavy : config.modelPrimary;
  const maxTokens = opts.maxTokens ?? 1024;
  const maxIterations = opts.maxIterations ?? 6;

  const sys = await getStaticSystem();
  const dyn = await buildDynamicSystem({
    sessionType: opts.sessionType,
    retrievalQuery: opts.retrievalQuery,
  });

  // Static block marked cacheable; dynamic block fresh each call.
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: sys, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dyn },
  ];

  const messages: ChatMessage[] = [...opts.messages];
  const ctx = { sessionType: opts.sessionType };

  // Accumulate token usage across all tool-use iterations; record once per turn.
  const agg: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const finish = async (text: string, stoppedEarly: boolean): Promise<RunTurnResult> => {
    await recordTurnUsage({ model, tier, sessionType: opts.sessionType, usage: agg });
    return { text, messages, stoppedEarly };
  };

  for (let i = 0; i < maxIterations; i++) {
    let resp: Anthropic.Message;
    try {
      resp = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools: TOOLS,
        messages,
      });
    } catch (err: any) {
      logger.error({ err }, 'Anthropic call failed');
      throw err;
    }

    agg.input += resp.usage?.input_tokens ?? 0;
    agg.output += resp.usage?.output_tokens ?? 0;
    agg.cacheRead += resp.usage?.cache_read_input_tokens ?? 0;
    agg.cacheWrite += resp.usage?.cache_creation_input_tokens ?? 0;

    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          logger.info({ tool: block.name }, 'Executing tool');
          const result = await executeTool(block.name, block.input, ctx);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }
      }
      // Guard: if stop_reason was tool_use but we recognized no tool_use blocks,
      // posting an empty content array would 400 the next call. Bail with whatever
      // text we have instead of looping into an invalid request.
      if (toolResults.length === 0) {
        logger.warn('tool_use stop with no executable tool blocks; ending turn');
        const text = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        return finish(text, true);
      }
      messages.push({ role: 'user', content: toolResults });
      continue; // let the model use the tool results
    }

    // Final answer.
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return finish(text, false);
  }

  logger.warn('runTurn hit iteration cap without a final answer');
  return finish('', true);
}
