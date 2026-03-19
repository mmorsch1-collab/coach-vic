import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Define configuration schema with validation
const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  host: z.string().default('127.0.0.1'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  google: z.object({
    clientId: z.string().min(1, 'Google Client ID is required'),
    clientSecret: z.string().min(1, 'Google Client Secret is required'),
    redirectUri: z.string().url().default('http://127.0.0.1:3000/auth/google/callback'),
    sheetId: z.string().min(1, 'Google Sheet ID is required'),
  }),
  whoop: z.object({
    clientId: z.string().min(1, 'WHOOP Client ID is required'),
    clientSecret: z.string().min(1, 'WHOOP Client Secret is required'),
    redirectUri: z.string().url().default('http://127.0.0.1:3000/auth/whoop/callback'),
  }),
  withings: z.object({
    clientId: z.string().min(1, 'Withings Client ID is required'),
    clientSecret: z.string().min(1, 'Withings Client Secret is required'),
    redirectUri: z.string().url().default('http://127.0.0.1:3000/auth/withings/callback'),
  }),
  strava: z.object({
    clientId: z.string().min(1, 'Strava Client ID is required'),
    clientSecret: z.string().min(1, 'Strava Client Secret is required'),
    redirectUri: z.string().url().default('http://127.0.0.1:3000/auth/strava/callback'),
  }),
  tokenStoragePath: z.string().default('./tokens.json'),
});

// Parse and validate configuration
function loadConfig() {
  try {
    const config = configSchema.parse({
      port: process.env.PORT,
      host: process.env.HOST,
      nodeEnv: process.env.NODE_ENV,
      logLevel: process.env.LOG_LEVEL,
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
        sheetId: process.env.GOOGLE_SHEET_ID,
      },
      whoop: {
        clientId: process.env.WHOOP_CLIENT_ID,
        clientSecret: process.env.WHOOP_CLIENT_SECRET,
        redirectUri: process.env.WHOOP_REDIRECT_URI,
      },
      withings: {
        clientId: process.env.WITHINGS_CLIENT_ID,
        clientSecret: process.env.WITHINGS_CLIENT_SECRET,
        redirectUri: process.env.WITHINGS_REDIRECT_URI,
      },
      strava: {
        clientId: process.env.STRAVA_CLIENT_ID,
        clientSecret: process.env.STRAVA_CLIENT_SECRET,
        redirectUri: process.env.STRAVA_REDIRECT_URI,
      },
      tokenStoragePath: process.env.TOKEN_STORAGE_PATH,
    });
    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Configuration validation failed:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
    }
    throw new Error('Invalid configuration');
  }
}

export const config = loadConfig();
export type Config = z.infer<typeof configSchema>;
