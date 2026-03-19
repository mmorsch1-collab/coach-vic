import pino from 'pino';
import { config } from './config.js';

// Create structured logger with pretty printing in development
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
});

// Create request logger middleware for Express
export function createRequestLogger() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info({
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration,
        ip: req.ip,
      }, 'HTTP Request');
    });

    next();
  };
}
