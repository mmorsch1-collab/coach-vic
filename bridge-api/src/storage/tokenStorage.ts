import fs from 'fs/promises';
import path from 'path';
import { logger } from '../logger.js';
import { config } from '../config.js';

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scope: string;
  tokenType: string;
  userId?: string; // Optional user ID (required for Withings)
}

export interface TokenStore {
  google?: TokenData;
  whoop?: TokenData;
  withings?: TokenData;
  strava?: TokenData;
}

/**
 * Token storage manager for OAuth tokens
 * Stores tokens in a local JSON file (NOT encrypted for simplicity)
 * In production, consider encrypting tokens or using a secure store
 *
 * PERFORMANCE: Uses in-memory cache to avoid repeated disk I/O
 */
export class TokenStorage {
  private filePath: string;
  private cache: TokenStore | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute

  constructor(filePath?: string) {
    this.filePath = filePath || config.tokenStoragePath;
  }

  /**
   * Read all tokens from storage (with memory caching)
   */
  async read(): Promise<TokenStore> {
    // Return cached tokens if fresh
    if (this.cache && Date.now() - this.cacheTimestamp < this.CACHE_TTL) {
      logger.debug('Returning cached tokens');
      return this.cache;
    }

    return this.readFresh();
  }

  /**
   * Read all tokens DIRECTLY from disk, bypassing the in-memory cache, and
   * refresh the cache with what was read.
   *
   * Used by the setX() methods immediately before a read-modify-write so that a
   * single-use refresh token rotated by a concurrent caller (in a DIFFERENT
   * provider key) is never clobbered by a stale cached copy of the store.
   */
  async readFresh(): Promise<TokenStore> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const tokens = JSON.parse(data) as TokenStore;

      // Update cache
      this.cache = tokens;
      this.cacheTimestamp = Date.now();

      logger.debug({ filePath: this.filePath }, 'Tokens read from storage and cached');
      return tokens;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        const emptyStore = {};
        this.cache = emptyStore;
        this.cacheTimestamp = Date.now();
        logger.debug({ filePath: this.filePath }, 'Token file does not exist, returning empty store');
        return emptyStore;
      }
      logger.error({ err: error, filePath: this.filePath }, 'Failed to read tokens');
      throw new Error(`Failed to read tokens: ${error.message}`);
    }
  }

  /**
   * Write all tokens to storage (updates cache)
   *
   * ATOMIC: writes to a temp file in the same directory and then renames it over
   * the target. rename() is atomic on the same filesystem, so a crash or
   * concurrent reader never observes a half-written / truncated tokens.json.
   */
  async write(tokens: TokenStore): Promise<void> {
    const dir = path.dirname(this.filePath);
    // Unique temp name avoids collisions between concurrent writers.
    const tmpPath = path.join(
      dir,
      `.tokens.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    );

    try {
      await fs.mkdir(dir, { recursive: true });

      const data = JSON.stringify(tokens, null, 2);
      // Write the full payload to the temp file first, then atomically swap it in.
      await fs.writeFile(tmpPath, data, 'utf-8');
      await fs.rename(tmpPath, this.filePath);

      // Update cache after write
      this.cache = tokens;
      this.cacheTimestamp = Date.now();

      logger.info({ filePath: this.filePath }, 'Tokens written to storage and cache updated');
    } catch (error: any) {
      // Best-effort cleanup of the temp file if the rename never happened.
      try {
        await fs.unlink(tmpPath);
      } catch {
        // ignore: temp file may not exist
      }
      logger.error({ err: error, filePath: this.filePath }, 'Failed to write tokens');
      throw new Error(`Failed to write tokens: ${error.message}`);
    }
  }

  /**
   * Invalidate cache (useful for testing or forced refresh)
   */
  invalidateCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
    logger.debug('Token cache invalidated');
  }

  /**
   * Serialize ALL read-modify-write mutations through a single chain.
   *
   * Why this is needed even with atomic writes + readFresh: the background
   * refresh runs `Promise.allSettled([google, strava, whoop, withings])`, so
   * several providers can rotate at once. Without serialization, two mutations
   * could both readFresh() the same store, then write() in sequence — the second
   * write would drop the first's just-rotated key (a lost update), reintroducing
   * a rarer version of the forced-re-auth bug precisely during the batch refresh.
   *
   * Here every mutation runs one-at-a-time: re-read latest from disk → apply →
   * atomic write. The chain survives individual failures so one bad mutation
   * doesn't wedge the rest.
   */
  private mutating: Promise<void> = Promise.resolve();
  private mutate(apply: (store: TokenStore) => void): Promise<void> {
    const run = this.mutating.then(async () => {
      const store = await this.readFresh();
      apply(store);
      await this.write(store);
    });
    // Keep the chain alive even if this mutation rejects.
    this.mutating = run.catch(() => undefined);
    return run;
  }

  /**
   * Get Google token
   */
  async getGoogleToken(): Promise<TokenData | null> {
    const store = await this.read();
    return store.google || null;
  }

  /**
   * Set Google token
   */
  async setGoogleToken(token: TokenData): Promise<void> {
    await this.mutate((store) => {
      store.google = token;
    });
  }

  /**
   * Delete Google token
   */
  async deleteGoogleToken(): Promise<void> {
    await this.mutate((store) => {
      delete store.google;
    });
    logger.info('Google token deleted from storage');
  }

  /**
   * Check if Google token exists
   */
  async hasGoogleToken(): Promise<boolean> {
    const token = await this.getGoogleToken();
    return token !== null;
  }

  /**
   * Get WHOOP token
   */
  async getWhoopToken(): Promise<TokenData | null> {
    const store = await this.read();
    return store.whoop || null;
  }

  /**
   * Set WHOOP token
   */
  async setWhoopToken(token: TokenData): Promise<void> {
    await this.mutate((store) => {
      store.whoop = token;
    });
  }

  /**
   * Delete WHOOP token
   */
  async deleteWhoopToken(): Promise<void> {
    await this.mutate((store) => {
      delete store.whoop;
    });
    logger.info('WHOOP token deleted from storage');
  }

  /**
   * Check if WHOOP token exists
   */
  async hasWhoopToken(): Promise<boolean> {
    const token = await this.getWhoopToken();
    return token !== null;
  }

  /**
   * Get Withings token
   */
  async getWithingsToken(): Promise<TokenData | null> {
    const store = await this.read();
    return store.withings || null;
  }

  /**
   * Set Withings token
   */
  async setWithingsToken(token: TokenData): Promise<void> {
    await this.mutate((store) => {
      store.withings = token;
    });
  }

  /**
   * Delete Withings token
   */
  async deleteWithingsToken(): Promise<void> {
    await this.mutate((store) => {
      delete store.withings;
    });
    logger.info('Withings token deleted from storage');
  }

  /**
   * Check if Withings token exists
   */
  async hasWithingsToken(): Promise<boolean> {
    const token = await this.getWithingsToken();
    return token !== null;
  }

  /**
   * Get Strava token
   */
  async getStravaToken(): Promise<TokenData | null> {
    const store = await this.read();
    return store.strava || null;
  }

  /**
   * Set Strava token
   */
  async setStravaToken(token: TokenData): Promise<void> {
    await this.mutate((store) => {
      store.strava = token;
    });
  }

  /**
   * Delete Strava token
   */
  async deleteStravaToken(): Promise<void> {
    await this.mutate((store) => {
      delete store.strava;
    });
    logger.info('Strava token deleted from storage');
  }

  /**
   * Check if Strava token exists
   */
  async hasStravaToken(): Promise<boolean> {
    const token = await this.getStravaToken();
    return token !== null;
  }
}

// Export singleton instance
export const tokenStorage = new TokenStorage();
