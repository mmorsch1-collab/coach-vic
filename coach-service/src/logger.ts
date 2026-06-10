import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  base: undefined, // omit pid/hostname noise
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
