import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Tiny atomic JSON persistence for operational state (delivery queue, dedup set,
 * daily counters, nudge state, scheduler bookkeeping).
 *
 * No native deps (deliberately — avoids node-gyp/SQLite build failures that would
 * need hands-on fixing). Writes are atomic (temp file + rename) and all mutations
 * to a given file are serialized through a per-path promise chain so concurrent
 * callers can't lose-update each other.
 */
export class JsonStore<T> {
  private readonly filePath: string;
  private readonly defaultValue: T;
  private cache: T | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(fileName: string, defaultValue: T) {
    this.filePath = path.join(config.stateDir, fileName);
    this.defaultValue = defaultValue;
  }

  async read(): Promise<T> {
    if (this.cache === null) {
      try {
        const raw = await fs.readFile(this.filePath, 'utf-8');
        this.cache = JSON.parse(raw) as T;
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          logger.error({ err, file: this.filePath }, 'Failed to read state file; using default');
        }
        this.cache = structuredClone(this.defaultValue);
      }
    }
    // Return a clone so callers can't mutate the cache outside the serialized
    // update() path (which would diverge in-memory state from disk).
    return structuredClone(this.cache);
  }

  /** Serialized read-modify-write. `apply` may return a value to pass back to the caller. */
  async update<R>(apply: (state: T) => R | Promise<R>): Promise<R> {
    let result!: R;
    const run = this.chain.then(async () => {
      const state = await this.read();
      result = await apply(state);
      await this.writeNow(state);
    });
    this.chain = run.catch(() => undefined);
    await run;
    return result;
  }

  private async writeNow(state: T): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
      await fs.rename(tmp, this.filePath);
      this.cache = state;
    } catch (err) {
      try {
        await fs.unlink(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
}
