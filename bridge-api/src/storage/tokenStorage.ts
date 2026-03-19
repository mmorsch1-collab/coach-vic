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
   */
  async write(tokens: TokenStore): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });

      const data = JSON.stringify(tokens, null, 2);
      await fs.writeFile(this.filePath, data, 'utf-8');

      // Update cache after write
      this.cache = tokens;
      this.cacheTimestamp = Date.now();

      logger.info({ filePath: this.filePath }, 'Tokens written to storage and cache updated');
    } catch (error: any) {
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
    const store = await this.read();
    store.google = token;
    await this.write(store);
  }

  /**
   * Delete Google token
   */
  async deleteGoogleToken(): Promise<void> {
    const store = await this.read();
    delete store.google;
    await this.write(store);
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
    const store = await this.read();
    store.whoop = token;
    await this.write(store);
  }

  /**
   * Delete WHOOP token
   */
  async deleteWhoopToken(): Promise<void> {
    const store = await this.read();
    delete store.whoop;
    await this.write(store);
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
    const store = await this.read();
    store.withings = token;
    await this.write(store);
  }

  /**
   * Delete Withings token
   */
  async deleteWithingsToken(): Promise<void> {
    const store = await this.read();
    delete store.withings;
    await this.write(store);
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
    const store = await this.read();
    store.strava = token;
    await this.write(store);
  }

  /**
   * Delete Strava token
   */
  async deleteStravaToken(): Promise<void> {
    const store = await this.read();
    delete store.strava;
    await this.write(store);
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
