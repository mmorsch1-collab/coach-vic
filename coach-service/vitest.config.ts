import { defineConfig } from 'vitest/config';

// Provide dummy env so modules that import ./config load during tests.
export default defineConfig({
  test: {
    env: {
      ANTHROPIC_API_KEY: 'test-key',
      TELEGRAM_BOT_TOKEN: 'test:token',
      TELEGRAM_CHAT_ID: '0',
      RETRIEVAL_MODE: 'keyword',
    },
    include: ['test/**/*.test.ts'],
  },
});
