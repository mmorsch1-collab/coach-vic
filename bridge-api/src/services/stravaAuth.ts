import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { tokenStorage, TokenData } from '../storage/tokenStorage.js';

/**
 * Strava OAuth2 service
 * Handles OAuth flow, token management, and API calls for Strava activities
 * API Documentation: https://developers.strava.com/docs/reference/
 */
export class StravaAuthService {
  private readonly STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
  private readonly STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
  private readonly STRAVA_API_BASE = 'https://www.strava.com/api/v3';

  // Scopes for Strava data access
  private readonly SCOPES = [
    'read', // Read public segments, public routes, public profile data, public posts, public events, club feeds
    'activity:read', // Read the user's activity data for activities that are visible
    'activity:read_all', // Read the user's activity data for all activities
    'profile:read_all', // Read all profile information (including private)
  ];

  /**
   * Generate authorization URL for OAuth flow
   */
  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: config.strava.clientId,
      redirect_uri: config.strava.redirectUri,
      response_type: 'code',
      approval_prompt: 'auto', // auto = only prompt if not already authorized
      scope: this.SCOPES.join(','),
      state: this.generateState(),
    });

    const url = `${this.STRAVA_AUTH_URL}?${params.toString()}`;
    logger.debug({ url }, 'Generated Strava OAuth authorization URL');
    return url;
  }

  /**
   * Generate random state parameter for CSRF protection
   */
  private generateState(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokensFromCode(code: string): Promise<TokenData> {
    try {
      logger.info('Exchanging Strava authorization code for tokens');

      const params = {
        client_id: config.strava.clientId,
        client_secret: config.strava.clientSecret,
        code,
        grant_type: 'authorization_code',
      };

      const response = await axios.post(this.STRAVA_TOKEN_URL, params, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      logger.info({ response: response.data }, 'Strava token response received');

      const { access_token, refresh_token, expires_at, athlete } = response.data;

      if (!access_token || !refresh_token) {
        logger.error({ responseData: response.data }, 'Strava response missing tokens');
        throw new Error('Missing tokens from Strava OAuth response');
      }

      const tokenData: TokenData = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiryDate: expires_at * 1000, // Strava returns unix timestamp in seconds
        scope: this.SCOPES.join(','),
        tokenType: 'Bearer',
        userId: athlete?.id?.toString() || 'unknown', // Store athlete ID
      };

      await tokenStorage.setStravaToken(tokenData);
      logger.info({ athleteId: athlete?.id }, 'Strava OAuth tokens obtained and stored successfully');

      return tokenData;
    } catch (error: any) {
      logger.error(
        { err: error.response?.data || error },
        'Failed to exchange code for Strava tokens'
      );
      throw new Error(`Strava OAuth token exchange failed: ${error.message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<TokenData> {
    const storedToken = await tokenStorage.getStravaToken();

    if (!storedToken || !storedToken.refreshToken) {
      logger.warn('No Strava refresh token available, clearing tokens');
      await tokenStorage.deleteStravaToken();
      throw new Error(
        'No Strava refresh token available. Please re-authenticate via /auth/strava/start'
      );
    }

    try {
      logger.info('Refreshing Strava access token');

      const params = {
        client_id: config.strava.clientId,
        client_secret: config.strava.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: storedToken.refreshToken,
      };

      const response = await axios.post(this.STRAVA_TOKEN_URL, params, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const { access_token, refresh_token, expires_at } = response.data;

      if (!access_token || !refresh_token) {
        throw new Error('Strava refresh response missing tokens');
      }

      const tokenData: TokenData = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiryDate: expires_at * 1000,
        scope: storedToken.scope,
        tokenType: 'Bearer',
        userId: storedToken.userId,
      };

      await tokenStorage.setStravaToken(tokenData);
      logger.info('Strava access token refreshed successfully');

      return tokenData;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      logger.error(
        { err: error.response?.data || error, errorMessage },
        'Failed to refresh Strava access token, clearing stored tokens'
      );

      // Clear invalid tokens to force re-authentication
      await tokenStorage.deleteStravaToken();

      throw new Error(
        `Strava token refresh failed: ${errorMessage}. Please re-authenticate via /auth/strava/start`
      );
    }
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidAccessToken(): Promise<string> {
    let tokenData = await tokenStorage.getStravaToken();

    if (!tokenData) {
      throw new Error(
        'No Strava tokens found. Please authenticate first via /auth/strava/start'
      );
    }

    // Check if token is expired or about to expire (within 5 minutes)
    if (tokenData.expiryDate < Date.now() + 5 * 60 * 1000) {
      logger.info('Strava access token expired or expiring soon, refreshing');
      tokenData = await this.refreshAccessToken();
    }

    return tokenData.accessToken;
  }

  /**
   * Make authenticated API request to Strava
   */
  async makeApiRequest<T>(endpoint: string, method: 'GET' | 'POST' = 'GET', data?: any): Promise<T> {
    const accessToken = await this.getValidAccessToken();

    try {
      const response = await axios({
        method,
        url: `${this.STRAVA_API_BASE}${endpoint}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        data,
      });

      return response.data as T;
    } catch (error: any) {
      logger.error({ err: error.response?.data || error, endpoint }, 'Strava API request failed');
      throw new Error(`Strava API request failed: ${error.message}`);
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    return await tokenStorage.hasStravaToken();
  }

  /**
   * Get token status information
   */
  async getTokenStatus(): Promise<{
    authenticated: boolean;
    expiresAt?: string;
    expiresIn?: number;
    hasRefreshToken: boolean;
    athleteId?: string;
  }> {
    const tokenData = await tokenStorage.getStravaToken();

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
      athleteId: tokenData.userId,
    };
  }

  /**
   * Revoke tokens and clear storage
   */
  async revokeAccess(): Promise<void> {
    const tokenData = await tokenStorage.getStravaToken();

    if (tokenData?.accessToken) {
      try {
        // Strava deauthorization endpoint
        await axios.post('https://www.strava.com/oauth/deauthorize', {
          access_token: tokenData.accessToken,
        });
        logger.info('Strava token deauthorized successfully');
      } catch (error: any) {
        logger.warn({ err: error }, 'Failed to deauthorize Strava token (continuing with local deletion)');
      }
    }

    await tokenStorage.deleteStravaToken();
    logger.info('Strava tokens removed from storage');
  }
}

// Export singleton instance
export const stravaAuth = new StravaAuthService();
