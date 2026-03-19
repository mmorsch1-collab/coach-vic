import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { googleAuth } from '../services/googleAuth.js';
import { whoopAuth } from '../services/whoopAuth.js';
import { withingsAuth } from '../services/withingsAuth.js';
import { stravaAuth } from '../services/stravaAuth.js';
import { logger } from '../logger.js';
import { SuccessResponse } from '../types.js';

const router = Router();

/**
 * GET /auth/google/start
 * Initiates Google OAuth flow
 * Redirects user to Google consent screen
 */
router.get(
  '/google/start',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Initiating Google OAuth flow');

    const authUrl = googleAuth.getAuthUrl();

    // Return HTML page that redirects to Google
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google OAuth - Bridge API</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 500px;
          }
          h1 { margin: 0 0 1rem; color: #333; }
          p { color: #666; margin-bottom: 2rem; }
          .btn {
            display: inline-block;
            background: #4285f4;
            color: white;
            padding: 12px 32px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
            transition: background 0.3s;
          }
          .btn:hover { background: #357ae8; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔐 Google OAuth</h1>
          <p>Click below to authorize Bridge API to access your Google Calendar (read-only).</p>
          <a href="${authUrl}" class="btn">Connect Google Account</a>
        </div>
      </body>
      </html>
    `);
  })
);

/**
 * GET /auth/google/callback
 * OAuth callback endpoint
 * Google redirects here after user grants/denies consent
 */
router.get(
  '/google/callback',
  asyncHandler(async (req: Request, res: Response) => {
    const { code, error } = req.query;

    // Handle user denial
    if (error) {
      logger.warn({ error }, 'User denied OAuth consent');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Failed - Bridge API</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 500px;
            }
            h1 { margin: 0 0 1rem; color: #333; }
            .error { color: #d32f2f; margin-bottom: 1rem; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Authorization Failed</h1>
            <p class="error">You denied access to your Google account.</p>
            <p>Bridge API needs calendar access to function. Please try again if this was a mistake.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Validate authorization code
    if (!code || typeof code !== 'string') {
      throw new AppError(400, 'Missing or invalid authorization code', 'INVALID_CODE');
    }

    logger.info('Received OAuth callback, exchanging code for tokens');

    try {
      // Exchange code for tokens
      await googleAuth.getTokensFromCode(code);

      logger.info('OAuth flow completed successfully');

      // Success page
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Success - Bridge API</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 500px;
            }
            h1 { margin: 0 0 1rem; color: #333; }
            .success { color: #2e7d32; margin-bottom: 1rem; font-size: 1.2rem; }
            p { color: #666; margin-bottom: 1rem; }
            .endpoint {
              background: #f5f5f5;
              padding: 0.5rem 1rem;
              border-radius: 4px;
              font-family: monospace;
              font-size: 0.9rem;
              margin-top: 1rem;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Success!</h1>
            <p class="success">Google account connected successfully</p>
            <p>Bridge API can now access your calendar. You can close this window.</p>
            <p>Try calling:</p>
            <div class="endpoint">GET http://127.0.0.1:3000/calendar/today</div>
          </div>
        </body>
        </html>
      `);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to complete OAuth flow');
      throw new AppError(500, 'Failed to complete OAuth flow', 'OAUTH_FAILED');
    }
  })
);

/**
 * GET /auth/google/status
 * Check if user is authenticated
 */
router.get(
  '/google/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const isAuthenticated = await googleAuth.isAuthenticated();

    const response: SuccessResponse<{ authenticated: boolean }> = {
      success: true,
      data: {
        authenticated: isAuthenticated,
      },
    };

    res.json(response);
  })
);

/**
 * POST /auth/google/revoke
 * Revoke Google OAuth tokens
 */
router.post(
  '/google/revoke',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Revoking Google OAuth tokens');

    await googleAuth.revokeAccess();

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: {
        message: 'Google OAuth tokens revoked successfully',
      },
    };

    res.json(response);
  })
);

/**
 * GET /auth/whoop/start
 * Initiates WHOOP OAuth flow
 * Redirects user to WHOOP consent screen
 */
router.get(
  '/whoop/start',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Initiating WHOOP OAuth flow');

    const authUrl = whoopAuth.getAuthUrl();

    // Return HTML page that redirects to WHOOP
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WHOOP OAuth - Bridge API</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #000000 0%, #434343 100%);
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 500px;
          }
          h1 { margin: 0 0 1rem; color: #333; }
          p { color: #666; margin-bottom: 2rem; }
          .btn {
            display: inline-block;
            background: #000000;
            color: white;
            padding: 12px 32px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
            transition: background 0.3s;
          }
          .btn:hover { background: #333333; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>💪 WHOOP OAuth</h1>
          <p>Click below to authorize Bridge API to access your WHOOP data (recovery, sleep, workouts).</p>
          <a href="${authUrl}" class="btn">Connect WHOOP Account</a>
        </div>
      </body>
      </html>
    `);
  })
);

/**
 * GET /auth/whoop/callback
 * OAuth callback endpoint
 * WHOOP redirects here after user grants/denies consent
 */
router.get(
  '/whoop/callback',
  asyncHandler(async (req: Request, res: Response) => {
    const { code, error } = req.query;

    // Handle user denial
    if (error) {
      logger.warn({ error }, 'User denied WHOOP OAuth consent');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Failed - Bridge API</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 500px;
            }
            h1 { margin: 0 0 1rem; color: #333; }
            .error { color: #d32f2f; margin-bottom: 1rem; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Authorization Failed</h1>
            <p class="error">You denied access to your WHOOP account.</p>
            <p>Bridge API needs WHOOP data access to function. Please try again if this was a mistake.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Validate authorization code
    if (!code || typeof code !== 'string') {
      throw new AppError(400, 'Missing or invalid authorization code', 'INVALID_CODE');
    }

    logger.info('Received WHOOP OAuth callback, exchanging code for tokens');

    try {
      // Exchange code for tokens
      await whoopAuth.getTokensFromCode(code);

      logger.info('WHOOP OAuth flow completed successfully');

      // Success page
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Success - Bridge API</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 500px;
            }
            h1 { margin: 0 0 1rem; color: #333; }
            .success { color: #2e7d32; margin-bottom: 1rem; font-size: 1.2rem; }
            p { color: #666; margin-bottom: 1rem; }
            .endpoint {
              background: #f5f5f5;
              padding: 0.5rem 1rem;
              border-radius: 4px;
              font-family: monospace;
              font-size: 0.9rem;
              margin-top: 1rem;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Success!</h1>
            <p class="success">WHOOP account connected successfully</p>
            <p>Bridge API can now access your WHOOP data. You can close this window.</p>
            <p>Try calling:</p>
            <div class="endpoint">GET http://127.0.0.1:3000/whoop/today</div>
          </div>
        </body>
        </html>
      `);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to complete WHOOP OAuth flow');
      throw new AppError(500, 'Failed to complete WHOOP OAuth flow', 'OAUTH_FAILED');
    }
  })
);

/**
 * GET /auth/whoop/status
 * Check if user is authenticated with WHOOP and get token status
 */
router.get(
  '/whoop/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const status = await whoopAuth.getTokenStatus();

    const response: SuccessResponse<typeof status> = {
      success: true,
      data: status,
    };

    res.json(response);
  })
);

/**
 * POST /auth/whoop/revoke
 * Revoke WHOOP OAuth tokens
 */
router.post(
  '/whoop/revoke',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Revoking WHOOP OAuth tokens');

    await whoopAuth.revokeAccess();

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: {
        message: 'WHOOP OAuth tokens revoked successfully',
      },
    };

    res.json(response);
  })
);

/**
 * GET /auth/whoop/privacy
 * Privacy policy page (required by WHOOP)
 */
router.get('/whoop/privacy', (_req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Privacy Policy - Bridge API</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 800px;
          margin: 2rem auto;
          padding: 2rem;
          line-height: 1.6;
          color: #333;
        }
        h1 { color: #000; }
        h2 { color: #333; margin-top: 2rem; }
        p { margin-bottom: 1rem; }
      </style>
    </head>
    <body>
      <h1>Privacy Policy</h1>
      <p><strong>Last Updated:</strong> February 14, 2026</p>

      <h2>Overview</h2>
      <p>Bridge API is a personal, localhost-only application that runs on your device. It does not collect, store, or share your data with any third parties.</p>

      <h2>Data Collection</h2>
      <p>Bridge API only accesses data that you explicitly authorize through OAuth connections:</p>
      <ul>
        <li>WHOOP: Recovery, sleep, workout, and cycle data</li>
        <li>Google: Calendar events and tasks</li>
        <li>Withings: Weight, body composition, and activity data</li>
      </ul>

      <h2>Data Storage</h2>
      <p>All data is stored locally on your device in the following locations:</p>
      <ul>
        <li>OAuth tokens: <code>./tokens.json</code></li>
        <li>Application data: Local files on your computer</li>
      </ul>
      <p><strong>No data is transmitted to external servers.</strong></p>

      <h2>Data Usage</h2>
      <p>Your data is used exclusively for:</p>
      <ul>
        <li>Generating personalized coaching insights</li>
        <li>Tracking goals and progress</li>
        <li>Managing your calendar and tasks</li>
      </ul>

      <h2>Data Sharing</h2>
      <p>Bridge API <strong>never shares your data</strong> with third parties. All processing happens locally on your device.</p>

      <h2>Data Retention</h2>
      <p>You can delete all stored data at any time by:</p>
      <ul>
        <li>Revoking OAuth tokens via the API</li>
        <li>Deleting the <code>tokens.json</code> file</li>
        <li>Uninstalling the application</li>
      </ul>

      <h2>Security</h2>
      <p>Bridge API binds exclusively to <code>127.0.0.1</code> (localhost) and is not accessible from the internet.</p>

      <h2>Contact</h2>
      <p>This is a personal application. For questions, contact the application owner.</p>
    </body>
    </html>
  `);
});

/**
 * GET /auth/withings/start
 * Initiates Withings OAuth flow
 * Redirects user to Withings consent screen
 */
router.get(
  '/withings/start',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Initiating Withings OAuth flow');

    const authUrl = withingsAuth.getAuthUrl();

    // Return HTML page that redirects to Withings
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Withings OAuth - Bridge API</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #00B0B9 0%, #00D5E4 100%);
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 500px;
          }
          h1 { margin: 0 0 1rem; color: #333; }
          p { color: #666; margin-bottom: 2rem; }
          .btn {
            display: inline-block;
            background: #00B0B9;
            color: white;
            padding: 12px 32px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
            transition: background 0.3s;
          }
          .btn:hover { background: #009AA3; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚖️ Withings OAuth</h1>
          <p>Click below to authorize Bridge API to access your Withings data (weight, body composition, activity).</p>
          <a href="${authUrl}" class="btn">Connect Withings Account</a>
        </div>
      </body>
      </html>
    `);
  })
);

/**
 * GET /auth/withings/callback
 * OAuth callback endpoint
 * Withings redirects here after user grants/denies consent
 */
router.get(
  '/withings/callback',
  asyncHandler(async (req: Request, res: Response) => {
    const { code, error } = req.query;

    // Handle user denial
    if (error) {
      logger.warn({ error }, 'User denied Withings OAuth consent');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Failed - Bridge API</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 500px;
            }
            h1 { margin: 0 0 1rem; color: #333; }
            .error { color: #d32f2f; margin-bottom: 1rem; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Authorization Failed</h1>
            <p class="error">You denied access to your Withings account.</p>
            <p>Bridge API needs Withings data access to function. Please try again if this was a mistake.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Validate authorization code
    if (!code || typeof code !== 'string') {
      throw new AppError(400, 'Missing or invalid authorization code', 'INVALID_CODE');
    }

    logger.info('Received Withings OAuth callback, exchanging code for tokens');

    try {
      // Exchange code for tokens
      await withingsAuth.getTokensFromCode(code);

      logger.info('Withings OAuth flow completed successfully');

      // Success page
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Success - Bridge API</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 500px;
            }
            h1 { margin: 0 0 1rem; color: #333; }
            .success { color: #2e7d32; margin-bottom: 1rem; font-size: 1.2rem; }
            p { color: #666; margin-bottom: 1rem; }
            .endpoint {
              background: #f5f5f5;
              padding: 0.5rem 1rem;
              border-radius: 4px;
              font-family: monospace;
              font-size: 0.9rem;
              margin-top: 1rem;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Success!</h1>
            <p class="success">Withings account connected successfully</p>
            <p>Bridge API can now access your Withings data. You can close this window.</p>
            <p>Try calling:</p>
            <div class="endpoint">GET http://127.0.0.1:3000/withings/measurements</div>
          </div>
        </body>
        </html>
      `);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to complete Withings OAuth flow');
      throw new AppError(500, 'Failed to complete Withings OAuth flow', 'OAUTH_FAILED');
    }
  })
);

/**
 * GET /auth/withings/status
 * Check if user is authenticated with Withings and get token status
 */
router.get(
  '/withings/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const status = await withingsAuth.getTokenStatus();

    const response: SuccessResponse<typeof status> = {
      success: true,
      data: status,
    };

    res.json(response);
  })
);

/**
 * POST /auth/withings/revoke
 * Revoke Withings OAuth tokens
 */
router.post(
  '/withings/revoke',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Revoking Withings OAuth tokens');

    await withingsAuth.revokeAccess();

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: {
        message: 'Withings OAuth tokens revoked successfully',
      },
    };

    res.json(response);
  })
);

/**
 * GET /auth/strava/start
 * Initiates Strava OAuth flow
 * Redirects user to Strava consent screen
 */
router.get(
  '/strava/start',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Initiating Strava OAuth flow');

    const authUrl = stravaAuth.getAuthUrl();

    // Return HTML page that redirects to Strava
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Strava OAuth - Bridge API</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #FC4C02 0%, #FC6442 100%);
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 500px;
          }
          h1 { margin: 0 0 1rem; color: #333; }
          p { color: #666; margin-bottom: 2rem; }
          .btn {
            display: inline-block;
            background: #FC4C02;
            color: white;
            padding: 12px 32px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
            transition: background 0.3s;
          }
          .btn:hover { background: #E34402; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚴 Strava OAuth</h1>
          <p>Click below to authorize Bridge API to access your Strava data (activities, profile, stats).</p>
          <a href="${authUrl}" class="btn">Connect Strava Account</a>
        </div>
      </body>
      </html>
    `);
  })
);

/**
 * GET /auth/strava/callback
 * OAuth callback endpoint
 * Strava redirects here after user grants/denies consent
 */
router.get(
  '/strava/callback',
  asyncHandler(async (req: Request, res: Response) => {
    const { code, error, scope } = req.query;

    // Handle user denial
    if (error) {
      logger.warn({ error }, 'User denied Strava OAuth consent');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Failed - Bridge API</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 500px;
            }
            h1 { margin: 0 0 1rem; color: #333; }
            .error { color: #d32f2f; margin-bottom: 1rem; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Authorization Failed</h1>
            <p class="error">You denied access to your Strava account.</p>
            <p>Bridge API needs Strava data access to function. Please try again if this was a mistake.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Validate authorization code
    if (!code || typeof code !== 'string') {
      throw new AppError(400, 'Missing or invalid authorization code', 'INVALID_CODE');
    }

    logger.info('Received Strava OAuth callback, exchanging code for tokens');

    try {
      // Exchange code for tokens
      await stravaAuth.getTokensFromCode(code);

      logger.info('Strava OAuth flow completed successfully');

      // Success page
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Success - Bridge API</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 500px;
            }
            h1 { margin: 0 0 1rem; color: #333; }
            .success { color: #2e7d32; margin-bottom: 1rem; font-size: 1.2rem; }
            p { color: #666; margin-bottom: 1rem; }
            .endpoint {
              background: #f5f5f5;
              padding: 0.5rem 1rem;
              border-radius: 4px;
              font-family: monospace;
              font-size: 0.9rem;
              margin-top: 1rem;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Success!</h1>
            <p class="success">Strava account connected successfully</p>
            <p>Bridge API can now access your Strava data. You can close this window.</p>
            <p>Try calling:</p>
            <div class="endpoint">GET http://127.0.0.1:3000/strava/latest</div>
          </div>
        </body>
        </html>
      `);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to complete Strava OAuth flow');
      throw new AppError(500, 'Failed to complete Strava OAuth flow', 'OAUTH_FAILED');
    }
  })
);

/**
 * GET /auth/strava/status
 * Check if user is authenticated with Strava and get token status
 */
router.get(
  '/strava/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const status = await stravaAuth.getTokenStatus();

    const response: SuccessResponse<typeof status> = {
      success: true,
      data: status,
    };

    res.json(response);
  })
);

/**
 * POST /auth/strava/revoke
 * Revoke Strava OAuth tokens
 */
router.post(
  '/strava/revoke',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Revoking Strava OAuth tokens');

    await stravaAuth.revokeAccess();

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: {
        message: 'Strava OAuth tokens revoked successfully',
      },
    };

    res.json(response);
  })
);

export default router;
