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
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map(stem);
}

/** Light stemming so "deloading"/"deloads" match "deload" (and vice versa). */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scoreKeyword(queryTokens: string[], entry: DbEntry): number {
  const hay = entry.body.toLowerCase();
  const title = entry.title.toLowerCase();
  let score = 0;
  for (const t of queryTokens) {
    if (!t) continue;
    // Word-boundary PREFIX match: "press" hits "press/presses/pressing" but not
    // "depressed"; substring matching was full of false positives.
    const re = new RegExp(`\\b${escapeRe(t)}`, 'g');
    const occurrences = (hay.match(re) || []).length;
    if (occurrences > 0) score += Math.min(occurrences, 3);
    if (new RegExp(`\\b${escapeRe(t)}`).test(title)) score += 2;
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

  // Score + a small recency boost (entries are append-only, so later index ≈ newer:
  // a fresh insight should outrank a same-score stale one). Then a relevance floor
  // relative to the top hit — weak matches are pure prompt noise — and a char
  // budget so retrieval can't balloon the prompt as the databases grow.
  const ranked = entries
    .map((e, i) => ({ e, s: scoreKeyword(qTokens, e) + (i / entries.length) * 1.5 }))
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s);

  const floor = ranked.length ? Math.max(2, ranked[0].s * 0.3) : 0;
  const scored: DbEntry[] = [];
  let budget = 5000; // chars across all rendered entries
  for (const x of ranked) {
    if (scored.length >= maxResults) break;
    if (x.s < floor) break;
    const len = x.e.body.length + 24;
    if (len > budget && scored.length > 0) continue; // keep smaller entries that still fit
    scored.push(x.e);
    budget -= len;
  }

  const rendered = scored.length
    ? scored.map((e) => `[${e.source}] ${e.body}`).join('\n\n---\n\n')
    : '';

  return { entries: scored, rendered };
}
