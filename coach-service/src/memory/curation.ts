import { runTurn } from '../llm/agent.js';
import { readRecentDailyLogs } from './store.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Scheduled memory maintenance (the "memory maintenance during heartbeats" loop):
 * review recent daily logs and distill durable items into the RAG databases /
 * MEMORY.md via tools. Runs in main session so it may touch MEMORY.md.
 */
export async function runDailyCuration(): Promise<void> {
  const recent = await readRecentDailyLogs(config.tz);
  if (!recent.trim()) {
    logger.info('Curation: nothing in recent daily logs to distill');
    return;
  }

  const instruction = [
    `Daily memory maintenance. Below are the last ~2 days of raw daily-log notes.`,
    `Distill anything DURABLE and worth keeping long-term:`,
    `- new stable preferences → remember() into PREFERENCES_PROFILE_DATABASE.md`,
    `- interventions that clearly worked/failed → COACHING_INSIGHTS_DATABASE.md`,
    `- new lasting context about Matt → CONTEXTUAL_MEMORY_DATABASE.md`,
    `- measurable trends → PERFORMANCE_PATTERNS_DATABASE.md`,
    `- a one-line distilled fact → update_long_term_memory (only if genuinely lasting).`,
    `Be conservative: skip transient noise. Do NOT message Matt. When done, reply "done".`,
    ``,
    `RECENT DAILY LOG:\n${recent}`,
  ].join('\n');

  try {
    await runTurn({
      messages: [{ role: 'user', content: instruction }],
      sessionType: 'main',
      tier: 'primary',
      maxTokens: 600,
      maxIterations: 8,
    });
    logger.info('Daily curation complete');
  } catch (err) {
    logger.warn({ err }, 'Daily curation failed (non-fatal)');
  }
}
