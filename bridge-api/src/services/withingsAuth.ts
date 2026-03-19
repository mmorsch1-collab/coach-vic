import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { tokenStorage, TokenData } from '../storage/tokenStorage.js';

/**
 * Withings OAuth2 service
 * Handles OAuth flow, token management, and API calls for Withings smart scale
 * API Documentation: https://developer.withings.com/api-reference/
 */
export class WithingsAuthService {
  private readonly WITHINGS_AUTH_URL = 'https://account.withings.com/oauth2_user/authorize2';
  private readonly WITHINGS_TOKEN_URL = 'https://wbsapi.withings.net/v2/oauth2';
  private readonly WITHINGS_API_BASE = 'https://wbsapi.withings.net';

  // Scopes for Withings data access
  private readonly SCOPES = [
    'user.info', // Basic user information
    'user.metrics', // Weight, body composition measurements
    'user.activity', // Activity data (optional)
  ];

  /**
   * Generate authorization URL for OAuth flow
   */
  getAuthUrl(): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.withings.clientId,
      redirect_uri: config.withings.redirectUri,
      scope: this.SCOPES.join(','),
      state: this.generateState(),
    });

    const url = `${this.WITHINGS_AUTH_URL}?${params.toString()}`;
    logger.debug({ url }, 'Generated Withings OAuth authorization URL');
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
      logger.info('Exchanging Withings authorization code for tokens');

      const params = {
        action: 'requesttoken',
        grant_type: 'authorization_code',
        client_id: config.withings.clientId,
        client_secret: config.withings.clientSecret,
        code,
        redirect_uri: config.withings.redirectUri,
      };

      const response = await axios.post(this.WITHINGS_TOKEN_URL, params, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      logger.info({ response: response.data }, 'Withings token response received');

      const { body, status } = response.data;

      if (status !== 0) {
        logger.error({ responseData: response.data }, 'Withings OAuth error response');
        throw new Error(`Withings API error: status ${status}`);
      }

      const { access_token, refresh_token, expires_in, userid } = body;

      if (!access_token || !refresh_token) {
        logger.error({ responseData: response.data }, 'Withings response missing tokens');
        throw new Error('Missing tokens from Withings OAuth response');
      }

      const tokenData: TokenData = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiryDate: Date.now() + expires_in * 1000,
        scope: this.SCOPES.join(','),
        tokenType: 'Bearer',
        userId: userid.toString(), // Store user ID for API calls
      };

      await tokenStorage.setWithingsToken(tokenData);
      logger.info({ userId: userid }, 'Withings OAuth tokens obtained and stored successfully');

      return tokenData;
    } catch (error: any) {
      logger.error(
        { err: error.response?.data || error },
        'Failed to exchange code for Withings tokens'
      );
      throw new Error(`Withings OAuth token exchange failed: ${error.message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<TokenData> {
    const storedToken = await tokenStorage.getWithingsToken();

    if (!storedToken || !storedToken.refreshToken) {
      logger.warn('No Withings refresh token available, clearing tokens');
      await tokenStorage.deleteWithingsToken();
      throw new Error(
        'No Withings refresh token available. Please re-authenticate via /auth/withings/start'
      );
    }

    try {
      logger.info('Refreshing Withings access token');

      const params = {
        action: 'requesttoken',
        grant_type: 'refresh_token',
        client_id: config.withings.clientId,
        client_secret: config.withings.clientSecret,
        refresh_token: storedToken.refreshToken,
      };

      const response = await axios.post(this.WITHINGS_TOKEN_URL, params, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const { body, status } = response.data;

      if (status !== 0) {
        throw new Error(`Withings API error: status ${status}`);
      }

      const { access_token, refresh_token, expires_in, userid } = body;

      if (!access_token || !refresh_token) {
        throw new Error('Withings refresh response missing tokens');
      }

      const tokenData: TokenData = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiryDate: Date.now() + expires_in * 1000,
        scope: storedToken.scope,
        tokenType: 'Bearer',
        userId: userid.toString(),
      };

      await tokenStorage.setWithingsToken(tokenData);
      logger.info('Withings access token refreshed successfully');

      return tokenData;
    } catch (error: any) {
      const errorMessage = error.response?.data?.body?.error || error.message;
      logger.error(
        { err: error.response?.data || error, errorMessage },
        'Failed to refresh Withings access token, clearing stored tokens'
      );

      // Clear invalid tokens to force re-authentication
      await tokenStorage.deleteWithingsToken();

      throw new Error(
        `Withings token refresh failed: ${errorMessage}. Please re-authenticate via /auth/withings/start`
      );
    }
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidAccessToken(): Promise<{ accessToken: string; userId: string }> {
    let tokenData = await tokenStorage.getWithingsToken();

    if (!tokenData) {
      throw new Error(
        'No Withings tokens found. Please authenticate first via /auth/withings/start'
      );
    }

    // Check if token is expired or about to expire (within 5 minutes)
    if (tokenData.expiryDate < Date.now() + 5 * 60 * 1000) {
      logger.info('Withings access token expired or expiring soon, refreshing');
      tokenData = await this.refreshAccessToken();
    }

    if (!tokenData.userId) {
      throw new Error('Withings user ID not found in stored token');
    }

    return {
      accessToken: tokenData.accessToken,
      userId: tokenData.userId,
    };
  }

  /**
   * Make authenticated API request to Withings
   */
  async makeApiRequest<T>(action: string, params: Record<string, any> = {}): Promise<T> {
    const { accessToken } = await this.getValidAccessToken();

    try {
      const requestParams = {
        action,
        ...params,
      };

      const response = await axios.post(this.WITHINGS_API_BASE + '/measure', requestParams, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const { body, status } = response.data;

      if (status !== 0) {
        throw new Error(`Withings API error: status ${status}`);
      }

      return body as T;
    } catch (error: any) {
      logger.error({ err: error.response?.data || error, action }, 'Withings API request failed');
      throw new Error(`Withings API request failed: ${error.message}`);
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    return await tokenStorage.hasWithingsToken();
  }

  /**
   * Get token status information
   */
  async getTokenStatus(): Promise<{
    authenticated: boolean;
    expiresAt?: string;
    expiresIn?: number;
    hasRefreshToken: boolean;
    userId?: string;
  }> {
    const tokenData = await tokenStorage.getWithingsToken();

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
      userId: tokenData.userId,
    };
  }

  /**
   * Revoke tokens and clear storage
   */
  async revokeAccess(): Promise<void> {
    await tokenStorage.deleteWithingsToken();
    logger.info('Withings tokens revoked and removed from storage');
  }
}

// Export singleton instance
export const withingsAuth = new WithingsAuthService();
