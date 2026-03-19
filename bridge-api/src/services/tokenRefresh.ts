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
export class TokenRefreshService {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

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

    // Run immediately on start
    this.refreshAllTokens();

    // Then run every 30 minutes
    this.intervalId = setInterval(() => {
      this.refreshAllTokens();
    }, this.REFRESH_INTERVAL_MS);
  }

  /**
   * Stop the token refresh service
   */
  stop(): void {
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
      } else {
        logger.debug('Google token still valid, no refresh needed');
      }
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to refresh Google token');
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
      } else {
        logger.debug('Strava token still valid, no refresh needed');
      }
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to refresh Strava token');
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
      } else {
        logger.debug('WHOOP token still valid, no refresh needed');
      }
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to refresh WHOOP token');
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
      } else {
        logger.debug('Withings token still valid, no refresh needed');
      }
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to refresh Withings token');
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
