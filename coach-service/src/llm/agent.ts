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
  /** Set false when the caller embeds the daily logs itself (e.g. curation). */
  includeRecentLogs?: boolean;
}

export interface RunTurnResult {
  text: string;
  messages: ChatMessage[]; // includes assistant + tool exchanges appended
  stoppedEarly: boolean;
}

/*
 * PROMPT-CACHING LAYOUT (prefix match over tools → system → messages):
 *   1. `system` holds ONLY the static brain (byte-stable) with a cache_control
 *      breakpoint — tools + static system cache together. Main chat uses a 1h
 *      TTL so sporadic Telegram messages all day keep reading one morning write.
 *   2. ALL per-turn dynamic context (time, snapshot, logs, RAG) is delivered as
 *      a <context> block INSIDE the newest user message — never in `system` —
 *      so it can't invalidate the conversation prefix.
 *   3. A breakpoint on the END OF PRIOR HISTORY (main sessions) lets turn N+1
 *      read turns 1..N at ~0.1x instead of full price.
 *   4. A ROLLING breakpoint on the newest tool_result batch makes iterations
 *      2..N of the tool loop read the whole prior request at ~0.1x.
 * Total markers per request ≤ 3 (limit is 4).
 */

type AnyBlock = Record<string, any>;

function toBlocks(content: ChatMessage['content']): AnyBlock[] {
  return typeof content === 'string'
    ? [{ type: 'text', text: content }]
    : (content as AnyBlock[]).map((b) => ({ ...b }));
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
    includeRecentLogs: opts.includeRecentLogs,
  });

  // Real chat (main + heavy): 1h TTL bridges the gaps between sporadic messages
  // (a 5m entry would expire between turns and re-write at 1.25x every time).
  // Everything else (isolated jobs, nightly Haiku curation) only reuses within
  // its own tool loop, where the cheaper 5m default suffices.
  const isChat = opts.sessionType === 'main' && tier === 'heavy';
  const prefixCache = isChat ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };

  // (1) Static-only system with the prefix breakpoint.
  const system = [{ type: 'text', text: sys, cache_control: prefixCache }] as Anthropic.TextBlockParam[];

  // Deep-enough copy: we mutate the last two messages' content below.
  const messages: ChatMessage[] = opts.messages.map((m) => ({ ...m }));

  // (2) Inject the dynamic context into the newest user message (after history).
  const last = messages[messages.length - 1];
  if (last?.role === 'user' && dyn.trim()) {
    last.content = [
      { type: 'text', text: `<context>\n${dyn}\n</context>` },
      ...toBlocks(last.content),
    ] as any;
  }

  // (3) Cross-turn read point: mark the end of the PRIOR history (stable bytes —
  // chat.ts persists clean text turns) so the whole conversation prefix caches.
  if (opts.sessionType === 'main' && messages.length >= 2) {
    const prev = { ...messages[messages.length - 2] };
    const blocks = toBlocks(prev.content);
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: prefixCache };
    prev.content = blocks as any;
    messages[messages.length - 2] = prev;
  }

  const ctx = { sessionType: opts.sessionType };

  // Accumulate token usage across all tool-use iterations; record once per turn.
  const agg: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const finish = async (text: string, stoppedEarly: boolean): Promise<RunTurnResult> => {
    await recordTurnUsage({ model, tier, sessionType: opts.sessionType, usage: agg });
    return { text, messages, stoppedEarly };
  };

  // (4) Rolling in-loop marker: moved to the newest tool_result batch each
  // iteration (and removed from the previous one) so consecutive requests stay
  // within the 20-block cache lookback even on long tool bursts.
  let rollingMarked: AnyBlock | null = null;

  // max_tokens salvage: accumulate truncated text and continue once, instead of
  // delivering a message that stops mid-sentence.
  const textParts: string[] = [];
  let continuedAfterTruncation = false;

  for (let i = 0; i < maxIterations; i++) {
    const lastIteration = i === maxIterations - 1;
    let resp: Anthropic.Message;
    try {
      resp = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools: TOOLS,
        messages,
        // Final allowed iteration: force a text answer so the turn's spend isn't
        // discarded as an empty reply when the model would rather keep tooling.
        ...(lastIteration ? { tool_choice: { type: 'none' as const } } : {}),
        // Sonnet defaults effort to 'high'; pin 'medium' to keep the 4.5-era
        // latency/cost profile for short coaching turns. Never send to Haiku (400s).
        ...(model.includes('sonnet') ? { output_config: { effort: 'medium' } } : {}),
        // Sonnet 5.5 thinks by default (and 400s on thinking 'disabled'); 'between_tools'
        // keeps the no-thinking 4.6 behavior so thinking doesn't eat the small max_tokens.
        ...(model.includes('sonnet-5-5') ? { thinking: { type: 'between_tools' } } : {}),
        // Cast: the pinned SDK (0.40.1) predates the `ttl` field, output_config,
        // and tool_choice 'none' in its types; the API accepts all (smoke-tested).
      } as any);
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
      // Move the rolling cache marker to the newest tool_result.
      if (rollingMarked) delete rollingMarked.cache_control;
      const newest = toolResults[toolResults.length - 1] as AnyBlock;
      newest.cache_control = { type: 'ephemeral' };
      rollingMarked = newest;

      messages.push({ role: 'user', content: toolResults });
      continue; // let the model use the tool results
    }

    // Final answer.
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Hit the output cap mid-message: continue once rather than send a cutoff.
    if (resp.stop_reason === 'max_tokens' && text && !continuedAfterTruncation && i < maxIterations - 1) {
      // The cap can land mid-tool-emission, leaving partial/orphan tool_use blocks
      // in the assistant message we just pushed. A tool_use with no tool_result in
      // the next message 400s the continuation request — so strip them, keeping the
      // salvageable text. (Tool effects already ran for any *completed* calls; these
      // truncated ones never executed.)
      if (resp.content.some((b) => b.type === 'tool_use')) {
        const textOnly = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
        messages[messages.length - 1] = { role: 'assistant', content: textOnly };
      }
      logger.warn({ maxTokens }, 'Output truncated at max_tokens; requesting continuation');
      continuedAfterTruncation = true;
      textParts.push(text);
      messages.push({
        role: 'user',
        content:
          '(Your previous message hit the output length limit mid-sentence. Continue EXACTLY where ' +
          'it cut off and finish the message — no preamble, do not repeat anything already written.)',
      });
      continue;
    }

    return finish([...textParts, text].filter(Boolean).join(''), false);
  }

  logger.warn('runTurn hit iteration cap without a final answer');
  return finish(textParts.join(''), true);
}
