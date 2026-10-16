import express from 'express';
import compression from 'compression';
import { config } from './config.js';
import { logger, createRequestLogger } from './logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { tokenRefreshService } from './services/tokenRefresh.js';
import healthRouter from './routes/health.js';
import whoopRouter from './routes/whoop.js';
import calendarRouter from './routes/calendar.js';
import authRouter from './routes/auth.js';
import coachingRouter from './routes/coaching.js';
import withingsRouter from './routes/withings.js';
import stravaRouter from './routes/strava.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { hostGuard, rateLimit, requireApiKey, resolveApiKey } from './middleware/security.js';

const app = express();

// bridge-api package root (src/ or dist/ → one level up) — home of .bridge-key.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Security first (middleware/security.ts): loopback Host only, rate limit, then
// an API key on every route except the human-opened OAuth pages and /health.
app.use(hostGuard());
app.use(
  rateLimit({
    windowMs: 60_000,
    max: Number(process.env.BRIDGE_RATE_LIMIT_PER_MIN) || 300,
  })
);
app.use(createRequestLogger());
app.use(requireApiKey(resolveApiKey(packageRoot)));

// Middleware
app.use(compression()); // Compress responses (60-80% size reduction)
app.use(express.json({ limit: '1mb' }));

// Disable x-powered-by header for security
app.disable('x-powered-by');

// Routes
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/whoop', whoopRouter);
app.use('/calendar', calendarRouter);
app.use('/coaching', coachingRouter);
app.use('/withings', withingsRouter);
app.use('/strava', stravaRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Route not found',
      code: 'NOT_FOUND',
    },
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server
function startServer() {
  const server = app.listen(config.port, config.host, () => {
    logger.info(
      {
        port: config.port,
        host: config.host,
        env: config.nodeEnv,
      },
      'Server started successfully'
    );

    // Start token refresh service
    tokenRefreshService.start();
    logger.info('Token refresh service started');
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    tokenRefreshService.stop();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    tokenRefreshService.stop();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });

  return server;
}

// Only start server if not in test mode
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

// Export app for testing
export { app };
