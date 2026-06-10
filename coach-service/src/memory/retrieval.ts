import { config } from '../config.js';
import { logger } from '../logger.js';
import { loadAllEntries, type DbEntry } from './databases.js';

/**
 * Retrieval over the RAG databases. Default = keyword/tag scoring (zero deps,
 * always works — exact parity with the old search_coaching_context.ps1, improved).
 * Optional "semantic" mode can be layered later via a pluggable embedder; if it
 * isn't available we transparently fall back to keyword so the service never
 * breaks waiting on a model download.
 */

const STOPWORDS = new Set([
  'the','a','an','and','or','for','to','of','in','on','is','are','how','what','do','does',
  'should','i','my','me','with','at','it','this','that','be','can','his','her','him',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function scoreKeyword(queryTokens: string[], entry: DbEntry): number {
  const hay = entry.body.toLowerCase();
  let score = 0;
  for (const t of queryTokens) {
    if (!t) continue;
    // count occurrences (capped) — frequency-weighted, like a tiny BM25.
    const occurrences = hay.split(t).length - 1;
    if (occurrences > 0) score += Math.min(occurrences, 3);
    // bonus if it appears in the title / Searchable / tags lines.
    if (/^##.*/m.test(entry.body) && entry.title.toLowerCase().includes(t)) score += 2;
  }
  return score;
}

export interface RetrievedContext {
  entries: DbEntry[];
  rendered: string; // ready to drop into a prompt
}

export async function retrieveContext(query: string, maxResults = 6): Promise<RetrievedContext> {
  const entries = await loadAllEntries();
  if (entries.length === 0) return { entries: [], rendered: '' };

  const qTokens = tokenize(query);
  if (qTokens.length === 0) return { entries: [], rendered: '' };

  // (Semantic mode hook: if config.retrievalMode === 'semantic' and an embedder is
  // installed, blend cosine similarity here. Falls through to keyword otherwise.)
  if (config.retrievalMode === 'semantic') {
    logger.debug('Semantic retrieval requested; embedder not bundled — using keyword fallback');
  }

  const scored = entries
    .map((e) => ({ e, s: scoreKeyword(qTokens, e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, maxResults)
    .map((x) => x.e);

  const rendered = scored.length
    ? scored.map((e) => `[${e.source}] ${e.body}`).join('\n\n---\n\n')
    : '';

  return { entries: scored, rendered };
}
