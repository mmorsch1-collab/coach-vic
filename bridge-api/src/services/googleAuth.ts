import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { tokenStorage, TokenData } from '../storage/tokenStorage.js';

/**
 * Google OAuth2 service
 * Handles OAuth flow, token management, and provides authenticated clients
 */
export class GoogleAuthService {
  private oauth2Client: OAuth2Client;

  // Scopes for calendar (read/write) and sheets access
  private readonly SCOPES = [
    'https://www.googleapis.com/auth/calendar', // Full calendar access (read + write)
    'https://www.googleapis.com/auth/spreadsheets',
  ];

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );

    // Set up token refresh handler
    this.oauth2Client.on('tokens', (tokens) => {
      logger.info('OAuth tokens refreshed automatically');
      if (tokens.refresh_token) {
        // Store updated tokens
        this.saveTokens(tokens).catch((err) => {
          logger.error({ err }, 'Failed to save refreshed tokens');
        });
      }
    });
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  getAuthUrl(): string {
    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // Get refresh token
      scope: this.SCOPES,
      prompt: 'consent', // Force consent screen to get refresh token
    });

    logger.debug({ url }, 'Generated OAuth authorization URL');
    return url;
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokensFromCode(code: string): Promise<TokenData> {
    try {
      logger.info('Exchanging authorization code for tokens');
      const { tokens } = await this.oauth2Client.getToken(code);

      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('Missing required tokens from OAuth response');
      }

      const tokenData: TokenData = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date || Date.now() + 3600 * 1000,
        scope: tokens.scope || this.SCOPES.join(' '),
        tokenType: tokens.token_type || 'Bearer',
      };

      await this.saveTokens(tokens);
      logger.info('OAuth tokens obtained and stored successfully');

      return tokenData;
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to exchange code for tokens');
      throw new Error(`OAuth token exchange failed: ${error.message}`);
    }
  }

  /**
   * Save tokens to storage
   */
  private async saveTokens(tokens: any): Promise<void> {
    const tokenData: TokenData = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date || Date.now() + 3600 * 1000,
      scope: tokens.scope || this.SCOPES.join(' '),
      tokenType: tokens.token_type || 'Bearer',
    };

    await tokenStorage.setGoogleToken(tokenData);
  }

  /**
   * Load tokens from storage and set credentials
   */
  async loadStoredTokens(): Promise<boolean> {
    const tokenData = await tokenStorage.getGoogleToken();

    if (!tokenData) {
      logger.debug('No stored tokens found');
      return false;
    }

    this.oauth2Client.setCredentials({
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
      expiry_date: tokenData.expiryDate,
      scope: tokenData.scope,
      token_type: tokenData.tokenType,
    });

    logger.info('Stored tokens loaded successfully');
    return true;
  }

  /**
   * Get authenticated OAuth2 client
   * Automatically loads stored tokens and refreshes if needed
   */
  async getAuthenticatedClient(): Promise<OAuth2Client> {
    const hasTokens = await this.loadStoredTokens();

    if (!hasTokens) {
      throw new Error('No OAuth tokens found. Please authenticate first via /auth/google/start');
    }

    // Check if token is expired or about to expire (within 5 minutes)
    const credentials = this.oauth2Client.credentials;
    if (credentials.expiry_date && credentials.expiry_date < Date.now() + 5 * 60 * 1000) {
      logger.info('Access token expired or expiring soon, refreshing');
      try {
        const { credentials: newCredentials } = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(newCredentials);
        await this.saveTokens(newCredentials);
        logger.info('Access token refreshed successfully');
      } catch (error: any) {
        logger.error({ err: error }, 'Failed to refresh access token');
        throw new Error('Failed to refresh access token. Please re-authenticate.');
      }
    }

    return this.oauth2Client;
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    return await tokenStorage.hasGoogleToken();
  }

  /**
   * Revoke tokens and clear storage
   */
  async revokeAccess(): Promise<void> {
    try {
      const hasTokens = await this.loadStoredTokens();
      if (hasTokens) {
        await this.oauth2Client.revokeCredentials();
        logger.info('OAuth tokens revoked');
      }
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to revoke tokens');
    } finally {
      await tokenStorage.deleteGoogleToken();
    }
  }
}

// Export singleton instance
export const googleAuth = new GoogleAuthService();
