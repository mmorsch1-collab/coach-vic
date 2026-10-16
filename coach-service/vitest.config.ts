import { defineConfig } from 'vitest/config';
import os from 'os';
import path from 'path';

// Provide dummy env so modules that import ./config load during tests.
export default defineConfig({
  test: {
    env: {
      ANTHROPIC_API_KEY: 'test-key',
      TELEGRAM_BOT_TOKEN: 'test:token',
      TELEGRAM_CHAT_ID: '0',
      RETRIEVAL_MODE: 'keyword',
      // Never let tests read/write the LIVE state dir: dotenv would otherwise load
      // STATE_DIR from .env (the production C:\dev\coach-data\state).
      STATE_DIR: path.join(os.tmpdir(), `coach-vic-test-state-${process.pid}`),
    },
    include: ['test/**/*.test.ts'],
  },
});
