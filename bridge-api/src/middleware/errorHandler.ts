import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger.js';
import { ErrorResponse } from '../types.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Handle validation errors from Zod
  if (err instanceof ZodError) {
    logger.warn({ err, path: req.path }, 'Validation error');
    const response: ErrorResponse = {
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: err.errors,
      },
    };
    return res.status(400).json(response);
  }

  // Handle custom application errors
  if (err instanceof AppError) {
    logger.warn({ err, path: req.path }, 'Application error');
    const response: ErrorResponse = {
      success: false,
      error: {
        message: err.message,
        code: err.code,
        details: err.details,
      },
    };
    return res.status(err.statusCode).json(response);
  }

  // Handle unexpected errors
  logger.error({ err, path: req.path }, 'Unexpected error');
  const response: ErrorResponse = {
    success: false,
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
  };
  return res.status(500).json(response);
}

// Async route wrapper to catch errors in async handlers
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
