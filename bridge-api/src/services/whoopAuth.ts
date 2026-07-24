import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { tokenStorage, TokenData } from '../storage/tokenStorage.js';
import { withRefreshLock, isInvalidGrantError, RetryableRefreshError } from './refreshGuard.js';

/**
 * WHOOP OAuth2 service
 * Handles OAuth flow, token management, and API calls
 */
export class WhoopAuthService {
  private readonly WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
  private readonly WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
  private readonly WHOOP_API_BASE_V1 = 'https://api.prod.whoop.com/developer/v1';
  private readonly WHOOP_API_BASE_V2 = 'https://api.prod.whoop.com/developer/v2';

  // Scopes for WHOOP data access
  private readonly SCOPES = [
    'offline', // Required for refresh tokens!
    'read:recovery',
    'read:cycles',
    'read:sleep',
    'read:workout',
    'read:profile',
  ];

  /**
   * Generate authorization URL for OAuth flow
   */
  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: config.whoop.clientId,
      redirect_uri: config.whoop.redirectUri,
      response_type: 'code',
      scope: this.SCOPES.join(' '),
      state: this.generateState(),
    });

    const url = `${this.WHOOP_AUTH_URL}?${params.toString()}`;
    logger.debug({ url }, 'Generated WHOOP OAuth authorization URL');
    return url;
  }

  /**
   * Generate random state parameter for CSRF protection
   */
  private generateState(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokensFromCode(code: string): Promise<TokenData> {
    try {
      logger.info('Exchanging WHOOP authorization code for tokens');

      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.whoop.clientId,
        client_secret: config.whoop.clientSecret,
        redirect_uri: config.whoop.redirectUri,
      });

      const response = await axios.post(
        this.WHOOP_TOKEN_URL,
        params.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      logger.info({ response: response.data }, 'WHOOP token response received');

      const { access_token, refresh_token, expires_in } = response.data;

      if (!access_token) {
        logger.error({ responseData: response.data }, 'WHOOP response missing access_token');
        throw new Error('Missing access_token from WHOOP OAuth response');
      }

      // Note: WHOOP may not return refresh_token on initial exchange
      const tokenData: TokenData = {
        accessToken: access_token,
        refreshToken: refresh_token || '', // Use empty string if not provided
        expiryDate: Date.now() + (expires_in || 3600) * 1000,
        scope: this.SCOPES.join(' '),
        tokenType: 'Bearer',
      };

      await tokenStorage.setWhoopToken(tokenData);
      logger.info('WHOOP OAuth tokens obtained and stored successfully');

      return tokenData;
    } catch (error: any) {
      logger.error({ err: error.response?.data || error }, 'Failed to exchange code for WHOOP tokens');
      throw new Error(`WHOOP OAuth token exchange failed: ${error.message}`);
    }
  }

  /**
   * Refresh access token using refresh token.
   *
   * WHOOP issues SINGLE-USE refresh tokens that rotate on every refresh, so:
   *  - runs under a per-provider single-flight lock so concurrent callers don't
   *    each consume the (now rotated) refresh token and race each other;
   *  - on transient failures (network/timeout/5xx/429) it KEEPS the stored
   *    tokens and throws a retryable error. It only clears tokens when WHOOP
   *    explicitly reports an invalid/expired grant.
   */
  async refreshAccessToken(): Promise<TokenData> {
    return withRefreshLock('whoop', async () => {
      const storedToken = await tokenStorage.getWhoopToken();

      if (!storedToken || !storedToken.refreshToken) {
        logger.warn('No WHOOP refresh token available, clearing tokens');
        await tokenStorage.deleteWhoopToken();
        throw new Error(
          'No WHOOP refresh token available. Please re-authenticate via /auth/whoop/start'
        );
      }

      try {
        logger.info('Refreshing WHOOP access token');

        const params = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: storedToken.refreshToken,
          client_id: config.whoop.clientId,
          client_secret: config.whoop.clientSecret,
        });

        const response = await axios.post(this.WHOOP_TOKEN_URL, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });

        const { access_token, refresh_token, expires_in } = response.data;

        if (!access_token) {
          throw new Error('WHOOP refresh response missing access_token');
        }

        const tokenData: TokenData = {
          accessToken: access_token,
          refreshToken: refresh_token || storedToken.refreshToken,
          expiryDate: Date.now() + (expires_in || 3600) * 1000,
          scope: storedToken.scope,
          tokenType: 'Bearer',
        };

        await tokenStorage.setWhoopToken(tokenData);
        logger.info('WHOOP access token refreshed successfully');

        return tokenData;
      } catch (error: any) {
        const errorMessage = error.response?.data?.error_description || error.message;

        // Only nuke tokens on a permanent invalid_grant. Transient errors
        // (network/timeout/5xx/429/rotation race) keep tokens for retry.
        if (isInvalidGrantError(error)) {
          logger.error(
            { err: error.response?.data || error, errorMessage },
            'WHOOP refresh rejected (invalid_grant), clearing stored tokens'
          );
          await tokenStorage.deleteWhoopToken();
          throw new Error(
            `WHOOP token refresh failed: ${errorMessage}. Please re-authenticate via /auth/whoop/start`
          );
        }

        logger.warn(
          { err: error.response?.data || error, errorMessage },
          'WHOOP refresh failed transiently, keeping tokens for retry'
        );
        throw new RetryableRefreshError(`WHOOP token refresh failed transiently: ${errorMessage}`);
      }
    });
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidAccessToken(): Promise<string> {
    let tokenData = await tokenStorage.getWhoopToken();

    if (!tokenData) {
      throw new Error('No WHOOP tokens found. Please authenticate first via /auth/whoop/start');
    }

    // Check if token is expired or about to expire (within 5 minutes)
    if (tokenData.expiryDate < Date.now() + 5 * 60 * 1000) {
      logger.info('WHOOP access token expired or expiring soon, refreshing');
      tokenData = await this.refreshAccessToken();
    }

    return tokenData.accessToken;
  }

  /**
   * Make authenticated API request to WHOOP
   */
  async makeApiRequest<T>(endpoint: string, version: 'v1' | 'v2' = 'v1'): Promise<T> {
    const accessToken = await this.getValidAccessToken();
    const baseUrl = version === 'v2' ? this.WHOOP_API_BASE_V2 : this.WHOOP_API_BASE_V1;

    try {
      const response = await axios.get(`${baseUrl}${endpoint}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data;
    } catch (error: any) {
      logger.error({ err: error.response?.data || error, endpoint }, 'WHOOP API request failed');
      throw new Error(`WHOOP API request failed: ${error.message}`);
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    return await tokenStorage.hasWhoopToken();
  }

  /**
   * Get token status information
   */
  async getTokenStatus(): Promise<{
    authenticated: boolean;
    expiresAt?: string;
    expiresIn?: number;
    hasRefreshToken: boolean;
  }> {
    const tokenData = await tokenStorage.getWhoopToken();

    if (!tokenData) {
      return {
        authenticated: false,
        hasRefreshToken: false,
      };
    }

    const expiresAt = new Date(tokenData.expiryDate).toISOString();
    const expiresIn = Math.max(0, Math.floor((tokenData.expiryDate - Date.now()) / 1000));

    return {
      authenticated: true,
      expiresAt,
      expiresIn,
      hasRefreshToken: !!tokenData.refreshToken,
    };
  }

  /**
   * Revoke tokens and clear storage
   */
  async revokeAccess(): Promise<void> {
    await tokenStorage.deleteWhoopToken();
    logger.info('WHOOP tokens revoked and removed from storage');
  }
}

// Export singleton instance
export const whoopAuth = new WhoopAuthService();
