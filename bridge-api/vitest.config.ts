import { defineConfig } from 'vitest/config';
import os from 'os';
import path from 'path';

// Dummy env so config.ts validates; no network or real tokens are touched.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      GOOGLE_CLIENT_ID: 'test',
      GOOGLE_CLIENT_SECRET: 'test',
      GOOGLE_SHEET_ID: 'test-sheet',
      WHOOP_CLIENT_ID: 'test',
      WHOOP_CLIENT_SECRET: 'test',
      WITHINGS_CLIENT_ID: 'test',
      WITHINGS_CLIENT_SECRET: 'test',
      STRAVA_CLIENT_ID: 'test',
      STRAVA_CLIENT_SECRET: 'test',
      TOKEN_STORAGE_PATH: path.join(os.tmpdir(), `bridge-test-tokens-${process.pid}-does-not-exist.json`),
      BRIDGE_API_KEY: 'test-bridge-key-0123456789abcdef0123456789abcdef',
      BRIDGE_RATE_LIMIT_PER_MIN: '10000',
    },
  },
});
