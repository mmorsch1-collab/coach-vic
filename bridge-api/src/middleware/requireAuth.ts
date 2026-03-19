import { Request, Response, NextFunction } from 'express';
import { asyncHandler, AppError } from './errorHandler.js';
import { googleAuth } from '../services/googleAuth.js';

/**
 * Middleware to require Google OAuth authentication
 * Throws 401 if user is not authenticated
 *
 * PERFORMANCE: Centralizes auth check to avoid duplication across routes
 */
export const requireGoogleAuth = asyncHandler(async (_req: Request, _res: Response, next: NextFunction) => {
  const isAuthenticated = await googleAuth.isAuthenticated();

  if (!isAuthenticated) {
    throw new AppError(
      401,
      'Not authenticated. Please visit /auth/google/start to connect your Google account.',
      'NOT_AUTHENTICATED'
    );
  }

  next();
});
