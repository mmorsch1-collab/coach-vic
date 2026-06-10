import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * The four RAG "databases" ported from the OpenClaw workspace. Each file holds
 * entries delimited by `## ` headers. We parse them into searchable records and
 * support appending new entries (write-back after coaching).
 */

export const DB_FILES = [
  'CONTEXTUAL_MEMORY_DATABASE.md',
  'COACHING_INSIGHTS_DATABASE.md',
  'PREFERENCES_PROFILE_DATABASE.md',
  'PERFORMANCE_PATTERNS_DATABASE.md',
] as const;
export type DbFile = (typeof DB_FILES)[number];

export interface DbEntry {
  source: DbFile;
  title: string;
  body: string; // full text of the entry incl. header
}

function dbPath(file: DbFile): string {
  return path.join(config.workspaceDir, 'databases', file);
}

export async function loadEntries(file: DbFile): Promise<DbEntry[]> {
  let raw = '';
  try {
    raw = await fs.readFile(dbPath(file), 'utf-8');
  } catch (err: any) {
    if (err.code !== 'ENOENT') logger.warn({ err, file }, 'Failed to read RAG db');
    return [];
  }
  // Split on lines beginning with "## " (entry headers), keep the header text.
  const chunks = raw.split(/(?=^## )/m).filter((c) => c.trim().length > 0);
  return chunks.map((chunk) => {
    const m = chunk.match(/^##\s+(.+)$/m);
    return { source: file, title: m ? m[1].trim() : '(untitled)', body: chunk.trim() };
  });
}

// Cache the parsed entries across turns; the DB files change at most once/day
// (curation) or when appendEntry runs, which invalidates the cache.
let allCache: DbEntry[] | null = null;

export async function loadAllEntries(): Promise<DbEntry[]> {
  if (allCache !== null) return allCache;
  const perFile = await Promise.all(DB_FILES.map((f) => loadEntries(f)));
  allCache = perFile.flat();
  return allCache;
}

export function invalidateEntriesCache(): void {
  allCache = null;
}

/**
 * Append a new entry to a database file. `header` becomes the `## ` title; `body`
 * is the entry content (markdown). Used for write-back (new contextual memories,
 * coaching insights, etc.).
 */
export async function appendEntry(file: DbFile, header: string, body: string): Promise<void> {
  const p = dbPath(file);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const block = `\n## ${header}\n${body.trim()}\n`;
  await fs.appendFile(p, block, 'utf-8');
  invalidateEntriesCache(); // next retrieval re-parses with the new entry
  logger.info({ file, header }, 'Appended RAG db entry');
}
