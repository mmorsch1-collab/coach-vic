import pino from 'pino';
import { config } from './config.js';
import { safeErr, scrubSecrets } from './logSafety.js';

// Every log object is scrubbed of credentials (API keys, bot token, OAuth
// tokens) and health/PII payloads before it is written — see logSafety.ts.
export const logger = pino({
  level: config.logLevel,
  base: undefined, // omit pid/hostname noise
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: safeErr, error: safeErr },
  formatters: {
    log: (obj) => scrubSecrets(obj, { health: true }) as Record<string, unknown>,
  },
});

export type Logger = typeof logger;
