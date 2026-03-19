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

const app = express();

// Middleware
app.use(compression()); // Compress responses (60-80% size reduction)
app.use(express.json());
app.use(createRequestLogger());

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
