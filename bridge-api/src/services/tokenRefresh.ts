import { logger } from '../logger.js';
import { googleAuth } from './googleAuth.js';
import { stravaAuth } from './stravaAuth.js';
import { whoopAuth } from './whoopAuth.js';
import { withingsAuth } from './withingsAuth.js';
import { tokenStorage } from '../storage/tokenStorage.js';

/**
 * Proactive token refresh service
 * Runs periodically to refresh OAuth tokens before they expire
 * This prevents token expiration errors when Coach Vic makes requests
 */
/**
 * Per-provider outcome of the BACKGROUND refresh (2026-10-16). Failures used to
 * be logged and nothing else, so a refresh that kept failing was invisible
 * until a data call broke. Exposed (key-protected) at GET /auth/refresh-status;
 * coach-service self-heal alerts on consecutive failures.
 */
export interface RefreshStatus {
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  consecutiveFailures: number;
}
type Provider = 'google' | 'strava' | 'whoop' | 'withings';
const status: Record<Provider, RefreshStatus> = {
  google: { consecutiveFailures: 0 },
  strava: { consecutiveFailures: 0 },
  whoop: { consecutiveFailures: 0 },
  withings: { consecutiveFailures: 0 },
};
export function getRefreshStatus(): Record<Provider, RefreshStatus> {
  return JSON.parse(JSON.stringify(status));
}
function recordOk(p: Provider) {
  status[p] = { ...status[p], lastSuccessAt: new Date().toISOString(), consecutiveFailures: 0, lastError: undefined };
}
function recordFail(p: Provider, err: any) {
  status[p] = {
    ...status[p],
    lastFailureAt: new Date().toISOString(),
    lastError: String(err?.message ?? err).slice(0, 200),
    consecutiveFailures: status[p].consecutiveFailures + 1,
  };
}

export class TokenRefreshService {
  private intervalId: NodeJS.Timeout | null = null;
  private bootTimeoutId: NodeJS.Timeout | null = null;
  private readonly REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  // Small jittered delay before the first refresh after boot. This avoids a
  // restart (or a briefly-overlapping second instance) firing an immediate
  // refresh that races with an in-progress rotation and consumes a single-use
  // refresh token. Each provider's refresh is also single-flight guarded, and
  // refreshAllTokens() only refreshes tokens actually expiring soon, so the
  // delayed first run is harmless to freshness.
  private readonly BOOT_REFRESH_MIN_MS = 60 * 1000; // 1 minute
  private readonly BOOT_REFRESH_JITTER_MS = 60 * 1000; // + up to 1 minute

  /**
   * Start the token refresh service
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Token refresh service already running');
      return;
    }

    logger.info(
      { intervalMinutes: this.REFRESH_INTERVAL_MS / 60000 },
      'Starting token refresh service'
    );

    // Do NOT refresh immediately on start. Instead, schedule the first run after
    // a short jittered delay (see BOOT_REFRESH_* above) so a restart can't kick
    // off a refresh that races a rotation already in flight elsewhere.
    const bootDelay =
      this.BOOT_REFRESH_MIN_MS + Math.floor(Math.random() * this.BOOT_REFRESH_JITTER_MS);
    logger.info({ bootDelayMs: bootDelay }, 'Scheduling initial token refresh after jittered delay');
    this.bootTimeoutId = setTimeout(() => {
      this.refreshAllTokens();
    }, bootDelay);

    // Then run every 30 minutes
    this.intervalId = setInterval(() => {
      this.refreshAllTokens();
    }, this.REFRESH_INTERVAL_MS);
  }

  /**
   * Stop the token refresh service
   */
  stop(): void {
    if (this.bootTimeoutId) {
      clearTimeout(this.bootTimeoutId);
      this.bootTimeoutId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Token refresh service stopped');
    }
  }

  /**
   * Refresh all OAuth tokens that are close to expiring
   */
  private async refreshAllTokens(): Promise<void> {
    logger.info('Running token refresh check for all services');

    await Promise.allSettled([
      this.refreshGoogleToken(),
      this.refreshStravaToken(),
      this.refreshWhoopToken(),
      this.refreshWithingsToken(),
    ]);
  }

  /**
   * Refresh Google token if it's expiring soon
   */
  private async refreshGoogleToken(): Promise<void> {
    try {
      const token = await tokenStorage.getGoogleToken();
      if (!token) {
        logger.debug('No Google token to refresh');
        return;
      }

      // Refresh if expiring in next 10 minutes
      if (token.expiryDate < Date.now() + 10 * 60 * 1000) {
        logger.info('Google token expiring soon, refreshing');
        await googleAuth.getAuthenticatedClient(); // This triggers auto-refresh
        logger.info('Google token refreshed successfully');
        recordOk('google');
      } else {
        logger.debug('Google token still valid, no refresh needed');
      }
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to refresh Google token');
      recordFail('google', error);
    }
  }

  /**
   * Refresh Strava token if it's expiring soon
   */
  private async refreshStravaToken(): Promise<void> {
    try {
      const token = await tokenStorage.getStravaToken();
      if (!token) {
        logger.debug('No Strava token to refresh');
        return;
      }

      // Refresh if expiring in next 30 minutes
      if (token.expiryDate < Date.now() + 30 * 60 * 1000) {
        logger.info('Strava token expiring soon, refreshing');
        await stravaAuth.refreshAccessToken();
        logger.info('Strava token refreshed successfully');
        recordOk('strava');
      } else {
        logger.debug('Strava token still valid, no refresh needed');
      }
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to refresh Strava token');
      recordFail('strava', error);
    }
  }

  /**
   * Refresh WHOOP token if it's expiring soon
   */
  private async refreshWhoopToken(): Promise<void> {
    try {
      const token = await tokenStorage.getWhoopToken();
      if (!token) {
        logger.debug('No WHOOP token to refresh');
        return;
      }

      // Refresh if expiring in next 30 minutes
      if (token.expiryDate < Date.now() + 30 * 60 * 1000) {
        logger.info('WHOOP token expiring soon, refreshing');
        await whoopAuth.refreshAccessToken();
        logger.info('WHOOP token refreshed successfully');
        recordOk('whoop');
      } else {
        logger.debug('WHOOP token still valid, no refresh needed');
      }
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to refresh WHOOP token');
      recordFail('whoop', error);
    }
  }

  /**
   * Refresh Withings token if it's expiring soon
   */
  private async refreshWithingsToken(): Promise<void> {
    try {
      const token = await tokenStorage.getWithingsToken();
      if (!token) {
        logger.debug('No Withings token to refresh');
        return;
      }

      // Refresh if expiring in next 30 minutes
      if (token.expiryDate < Date.now() + 30 * 60 * 1000) {
        logger.info('Withings token expiring soon, refreshing');
        await withingsAuth.refreshAccessToken();
        logger.info('Withings token refreshed successfully');
        recordOk('withings');
      } else {
        logger.debug('Withings token still valid, no refresh needed');
      }
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to refresh Withings token');
      recordFail('withings', error);
    }
  }

  /**
   * Manual trigger to refresh all tokens (for testing/admin)
   */
  async manualRefresh(): Promise<{
    google: boolean;
    strava: boolean;
    whoop: boolean;
    withings: boolean;
  }> {
    const results = await Promise.allSettled([
      this.refreshGoogleToken(),
      this.refreshStravaToken(),
      this.refreshWhoopToken(),
      this.refreshWithingsToken(),
    ]);

    return {
      google: results[0].status === 'fulfilled',
      strava: results[1].status === 'fulfilled',
      whoop: results[2].status === 'fulfilled',
      withings: results[3].status === 'fulfilled',
    };
  }
}

// Export singleton instance
export const tokenRefreshService = new TokenRefreshService();
