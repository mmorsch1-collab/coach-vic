import pino from 'pino';
import { config } from './config.js';
import { safeErr, scrubSecrets, scrubUrl } from './logSafety.js';

// Structured logger. Every log object is scrubbed of credentials and health/PII
// payloads before it is written (see logSafety.ts for why: the 2026-10-16 audit
// found client secrets and refresh tokens in bridge-api.out.log).
export const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    env: config.nodeEnv,
  },
  serializers: {
    err: safeErr,
    error: safeErr,
  },
  formatters: {
    log: (obj) => scrubSecrets(obj, { health: true }) as Record<string, unknown>,
  },
});

// Request logger middleware: method/path/status/duration only. OAuth callback
// query strings (?code=…&state=…) are scrubbed; the client IP is not logged
// (loopback-only service — it is always 127.0.0.1).
export function createRequestLogger() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info({
        method: req.method,
        url: scrubUrl(req.originalUrl ?? req.url),
        status: res.statusCode,
        duration,
      }, 'HTTP Request');
    });

    next();
  };
}
